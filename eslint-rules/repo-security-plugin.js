function isApiRoot(node) {
  return node?.type === 'Identifier' && (node.name === 'api' || node.name === 'anyApi');
}

function isPublicFunctionReference(node) {
  if (!node || node.type !== 'MemberExpression') {
    return false;
  }

  let current = node;
  while (current.object?.type === 'MemberExpression') {
    current = current.object;
  }

  return isApiRoot(current.object);
}

function isCronRegistration(node) {
  return (
    node?.callee?.type === 'MemberExpression' &&
    node.callee.object?.type === 'Identifier' &&
    node.callee.object.name === 'crons'
  );
}

function isSchedulerInvocation(node) {
  return (
    node?.callee?.type === 'MemberExpression' &&
    node.callee.object?.type === 'MemberExpression' &&
    node.callee.object.property?.type === 'Identifier' &&
    node.callee.object.property.name === 'scheduler' &&
    node.callee.property?.type === 'Identifier' &&
    (node.callee.property.name === 'runAfter' || node.callee.property.name === 'runAt')
  );
}

function isRunQueryMutationOrAction(node) {
  return (
    node?.callee?.type === 'MemberExpression' &&
    node.callee.object?.type === 'Identifier' &&
    node.callee.object.name === 'ctx' &&
    node.callee.property?.type === 'Identifier' &&
    (node.callee.property.name === 'runQuery' ||
      node.callee.property.name === 'runMutation' ||
      node.callee.property.name === 'runAction')
  );
}

function isPublicBuilderCall(node) {
  return (
    node?.type === 'CallExpression' &&
    node.callee?.type === 'Identifier' &&
    (node.callee.name === 'query' ||
      node.callee.name === 'mutation' ||
      node.callee.name === 'action')
  );
}

function getObjectPropertyValue(objectExpression, propertyName) {
  if (!objectExpression || objectExpression.type !== 'ObjectExpression') {
    return null;
  }

  for (const property of objectExpression.properties) {
    if (
      property?.type === 'Property' &&
      property.key?.type === 'Identifier' &&
      property.key.name === propertyName
    ) {
      return property.value ?? null;
    }
  }

  return null;
}

function getRootAstNode(context) {
  const sourceCode = context.sourceCode;
  return sourceCode.ast ?? sourceCode;
}

function getHandlerNode(callExpression) {
  const config = callExpression?.arguments?.[0];
  return getObjectPropertyValue(config, 'handler');
}

function getHandlerSourceText(context, handlerNode) {
  if (!handlerNode) {
    return null;
  }

  if (handlerNode.type === 'ArrowFunctionExpression' || handlerNode.type === 'FunctionExpression') {
    return context.sourceCode.getText(handlerNode);
  }

  if (handlerNode.type !== 'Identifier') {
    return null;
  }

  const program = getRootAstNode(context);
  if (!program || !Array.isArray(program.body)) {
    return null;
  }

  for (const statement of program.body) {
    if (
      statement?.type === 'FunctionDeclaration' &&
      statement.id?.type === 'Identifier' &&
      statement.id.name === handlerNode.name
    ) {
      return context.sourceCode.getText(statement);
    }
  }

  return null;
}

function getPublicExportName(callExpression) {
  const declarator = callExpression?.parent;
  const declaration = declarator?.parent;
  const exportDeclaration = declaration?.parent;

  if (
    declarator?.type !== 'VariableDeclarator' ||
    declarator.id?.type !== 'Identifier' ||
    declaration?.type !== 'VariableDeclaration' ||
    exportDeclaration?.type !== 'ExportNamedDeclaration'
  ) {
    return null;
  }

  return declarator.id.name;
}

const AUTH_GUARD_PATTERNS = [
  /\bgetVerifiedCurrent[A-Za-z0-9_]*\(\s*ctx\b/,
  /\brequire[A-Z][A-Za-z0-9_]*\(\s*ctx\b/,
  /\brunBetterAuthAction\(\s*ctx\b/,
  /\bgetCurrent[A-Za-z0-9_]*Context(?:OrNull)?\(\s*ctx\b/,
  /\bgetCurrentUserOrNull\(\s*ctx\b/,
  /\bgetVerifiedCurrentAuthUserOrNull\(\s*ctx\b/,
  /\bgetCurrentAuthUserOr(?:Throw|Null)\(\s*ctx\b/,
  /\bauthComponent\.getAuthUser\(\s*ctx\b/,
  /\bgetAuthenticated[A-Za-z0-9_]*\(\s*ctx\b/,
  /\bctx\.runQuery\(\s*internal\.[A-Za-z0-9_.]*getCurrentChatContextInternal\b/,
  /\bgetOrganizationAccessContextById\(\s*ctx\b/,
  /\bgetOrganizationAccessContextBySlug\(\s*ctx\b/,
  /\bbuildOrganizationPermissionDecision\(\s*ctx\b/,
  /\bchangeOrganizationMemberStatus\(\s*ctx\b/,
];

const SENSITIVE_ACTION_NAME_PATTERN =
  /(UploadTarget|FromUpload|PasswordReset|Revoke|BanUser|UnbanUser|SetUserPassword|CreateUser|UpdateUser|SetRole|ScimToken|PdfParse)/;

const RATE_LIMIT_PATTERNS = [
  /\brateLimit\b/,
  /\bretryAfter\b/,
  /\benforce[A-Za-z0-9_]*RateLimit[A-Za-z0-9_]*\(/,
  /\brunBetterAuthAction\(\s*ctx\b/,
];

const SITE_ADMIN_GUARD_PATTERNS = [
  /\bgetVerifiedCurrentSiteAdminUserOrThrow\(\s*ctx\b/,
  /\bgetVerifiedCurrentSiteAdminUserFromActionOrThrow\(\s*ctx\b/,
];

const SENSITIVE_QUERY_STRONG_GUARD_PATTERNS = [
  ...SITE_ADMIN_GUARD_PATTERNS,
  /\bgetVerifiedCurrentUserOrThrow\(\s*ctx\b/,
  /\brequireOrganizationPermission\(\s*ctx\b/,
  /\bgetOrganizationAccessContextById\(\s*ctx\b/,
  /\bgetOrganizationAccessContextBySlug\(\s*ctx\b/,
  /\bbuildOrganizationPermissionDecision\(\s*ctx\b/,
  /\bgetVerifiedCurrentAuthUserOrNull\(\s*ctx\b[\s\S]{0,400}\bthrow[A-Za-z]*\b/,
];

const SENSITIVE_QUERY_DISALLOWED_PATTERNS = [
  /\bsecurity-lint-ok:\s*public-query\b/,
  /\bgetCurrentUserOrNull\(\s*ctx\b/,
  /\bgetCurrentChatContextOrNull\(\s*ctx\b/,
];

const SENSITIVE_QUERY_EXPORT_NAMES = new Set([
  'getAuditLogs',
  'getSecurityPostureSummary',
  'getAuditReadinessOverview',
  'listSecurityControlWorkspaces',
  'listSecurityControlEvidenceActivity',
  'listEvidenceReports',
  'resolveOrganizationPermissionById',
  'resolveOrganizationPermissionBySlug',
  'resolveStorageReadAccess',
  'getOrganizationSettings',
  'getOrganizationEnterpriseAuthSettings',
  'getOrganizationEnterpriseAccess',
  'getOrganizationWriteAccess',
  'getOrganizationMemberJoinAccess',
  'listOrganizationDirectory',
  'listOrganizationDomains',
  'listOrganizationAuditEvents',
]);

function getContainingInternalHandlerCall(node) {
  let current = node.parent ?? null;

  while (current) {
    if (current.type === 'ArrowFunctionExpression' || current.type === 'FunctionExpression') {
      const handlerProperty = current.parent;
      const objectExpression = handlerProperty?.parent;
      const callExpression = objectExpression?.parent;

      if (
        handlerProperty?.type === 'Property' &&
        handlerProperty.key?.type === 'Identifier' &&
        handlerProperty.key.name === 'handler' &&
        handlerProperty.value === current &&
        objectExpression?.type === 'ObjectExpression' &&
        callExpression?.type === 'CallExpression' &&
        callExpression.callee?.type === 'Identifier' &&
        (callExpression.callee.name === 'internalAction' ||
          callExpression.callee.name === 'internalMutation' ||
          callExpression.callee.name === 'internalQuery')
      ) {
        return callExpression;
      }
    }

    current = current.parent ?? null;
  }

  return null;
}

function isPublicHandlerCall(node, builderName) {
  return (
    node?.type === 'CallExpression' &&
    node.callee?.type === 'Identifier' &&
    node.callee.name === builderName
  );
}

function isConvexBuilderCall(node) {
  return (
    node?.type === 'CallExpression' &&
    node.callee?.type === 'Identifier' &&
    (node.callee.name === 'query' ||
      node.callee.name === 'mutation' ||
      node.callee.name === 'action' ||
      node.callee.name === 'internalQuery' ||
      node.callee.name === 'internalMutation' ||
      node.callee.name === 'internalAction')
  );
}

function hasNamedProperty(objectExpression, propertyName) {
  return getObjectPropertyValue(objectExpression, propertyName) !== null;
}

function getHttpRouteConfig(node) {
  if (
    node?.type !== 'CallExpression' ||
    node.callee?.type !== 'MemberExpression' ||
    node.callee.object?.type !== 'Identifier' ||
    node.callee.object.name !== 'http' ||
    node.callee.property?.type !== 'Identifier' ||
    node.callee.property.name !== 'route'
  ) {
    return null;
  }

  const config = node.arguments[0];
  return config?.type === 'ObjectExpression' ? config : null;
}

function getStaticStringProperty(objectExpression, propertyName) {
  const value = getObjectPropertyValue(objectExpression, propertyName);
  return value?.type === 'Literal' && typeof value.value === 'string' ? value.value : null;
}

function hasSuppressionReason(sourceText, marker) {
  if (!sourceText.includes(marker)) {
    return true;
  }

  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const reasonPattern = new RegExp(`${escaped}[\\s\\S]{0,120}reason\\s*:`, 'i');
  return reasonPattern.test(sourceText);
}

const noPublicFunctionRefsInBackground = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow public Convex function references in background scheduling surfaces.',
    },
    schema: [],
    messages: {
      noPublicRef:
        'Background scheduling must reference internal Convex functions, not public {{ root }}.* APIs.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        let referenceNode = null;

        if (isCronRegistration(node)) {
          referenceNode = node.arguments[2] ?? null;
        } else if (isSchedulerInvocation(node)) {
          referenceNode = node.arguments[1] ?? null;
        }

        if (!isPublicFunctionReference(referenceNode)) {
          return;
        }

        let current = referenceNode;
        while (current.object?.type === 'MemberExpression') {
          current = current.object;
        }

        context.report({
          node: referenceNode,
          messageId: 'noPublicRef',
          data: { root: current.object.name },
        });
      },
    };
  },
};

export default {
  rules: {
    'no-public-function-refs-in-background': noPublicFunctionRefsInBackground,
    'no-public-run-in-internal-handler': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Disallow ctx.runQuery/ctx.runMutation with api/anyApi refs inside internal Convex handlers.',
        },
        schema: [],
        messages: {
          noPublicRun:
            'Internal Convex handlers must use internal.* references with {{ method }}, not public {{ root }}.* APIs.',
        },
      },
      create(context) {
        return {
          CallExpression(node) {
            if (!isRunQueryMutationOrAction(node)) {
              return;
            }

            if (!getContainingInternalHandlerCall(node)) {
              return;
            }

            const referenceNode = node.arguments[0] ?? null;
            if (!isPublicFunctionReference(referenceNode)) {
              return;
            }

            let current = referenceNode;
            while (current.object?.type === 'MemberExpression') {
              current = current.object;
            }

            context.report({
              node: referenceNode,
              messageId: 'noPublicRun',
              data: {
                method: node.callee.property.name,
                root: current.object.name,
              },
            });
          },
        };
      },
    },
    'require-auth-gate-in-public-handler': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Require a recognized auth or authorization helper in inline public Convex handlers unless explicitly opted out.',
        },
        schema: [],
        messages: {
          missingAuthGate:
            'Public Convex handler "{{ name }}" is missing a recognized auth gate. Add a repo auth helper call or mark it with "security-lint-ok: public".',
        },
      },
      create(context) {
        return {
          CallExpression(node) {
            if (!isPublicBuilderCall(node)) {
              return;
            }

            const exportName = getPublicExportName(node);
            if (!exportName) {
              return;
            }

            const handler = getHandlerNode(node);
            const sourceText = getHandlerSourceText(context, handler);
            if (!sourceText) {
              return;
            }
            const isQueryHandler = node.callee.name === 'query';

            if (
              sourceText.includes('security-lint-ok: public') ||
              (isQueryHandler && sourceText.includes('security-lint-ok: public-query'))
            ) {
              return;
            }

            if (AUTH_GUARD_PATTERNS.some((pattern) => pattern.test(sourceText))) {
              return;
            }

            context.report({
              node: handler,
              messageId: 'missingAuthGate',
              data: { name: exportName },
            });
          },
        };
      },
    },
    'require-rate-limit-in-sensitive-action': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Require a recognized rate-limit helper in sensitive public Convex actions unless explicitly opted out.',
        },
        schema: [],
        messages: {
          missingRateLimit:
            'Sensitive public action "{{ name }}" is missing a recognized rate-limit guard. Add a rate-limit helper or mark it with "security-lint-ok: no-rate-limit-needed".',
        },
      },
      create(context) {
        return {
          CallExpression(node) {
            if (!isPublicHandlerCall(node, 'action')) {
              return;
            }

            const exportName = getPublicExportName(node);
            if (!exportName || !SENSITIVE_ACTION_NAME_PATTERN.test(exportName)) {
              return;
            }

            const handler = getHandlerNode(node);
            const sourceText = getHandlerSourceText(context, handler);
            if (!sourceText) {
              return;
            }
            if (sourceText.includes('security-lint-ok: no-rate-limit-needed')) {
              return;
            }

            if (RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(sourceText))) {
              return;
            }

            context.report({
              node: handler,
              messageId: 'missingRateLimit',
              data: { name: exportName },
            });
          },
        };
      },
    },
    'require-convex-validators': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Require args and returns validators on Convex function builders.',
        },
        schema: [],
        messages: {
          missingArgs:
            'Convex handler "{{ name }}" is missing an args validator. Add an explicit "args" property.',
          missingReturns:
            'Convex handler "{{ name }}" is missing a returns validator. Add an explicit "returns" property.',
        },
      },
      create(context) {
        return {
          CallExpression(node) {
            if (!isConvexBuilderCall(node)) {
              return;
            }

            const config = node.arguments[0];
            if (!config || config.type !== 'ObjectExpression') {
              return;
            }

            const exportName = getPublicExportName(node) ?? '<anonymous>';

            if (!hasNamedProperty(config, 'args')) {
              context.report({
                node,
                messageId: 'missingArgs',
                data: { name: exportName },
              });
            }

            if (!hasNamedProperty(config, 'returns')) {
              context.report({
                node,
                messageId: 'missingReturns',
                data: { name: exportName },
              });
            }
          },
        };
      },
    },
    'require-site-admin-guard-in-security-module': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Require public handlers in convex/security.ts to use a recognized site-admin helper unless explicitly opted out.',
        },
        schema: [],
        messages: {
          missingSiteAdminGuard:
            'Security handler "{{ name }}" is missing a recognized site-admin guard. Use a site-admin helper or mark it with "security-lint-ok: site-admin-not-required".',
        },
      },
      create(context) {
        const filename = context.filename ?? context.getFilename?.() ?? '';
        if (
          !filename.endsWith('/convex/security.ts') &&
          !filename.endsWith('\\convex\\security.ts')
        ) {
          return {};
        }

        return {
          CallExpression(node) {
            if (!isPublicBuilderCall(node)) {
              return;
            }

            const exportName = getPublicExportName(node);
            if (!exportName) {
              return;
            }

            const handler = getHandlerNode(node);
            const sourceText = getHandlerSourceText(context, handler);
            if (!sourceText) {
              return;
            }

            if (sourceText.includes('security-lint-ok: site-admin-not-required')) {
              return;
            }

            if (SITE_ADMIN_GUARD_PATTERNS.some((pattern) => pattern.test(sourceText))) {
              return;
            }

            context.report({
              node: handler,
              messageId: 'missingSiteAdminGuard',
              data: { name: exportName },
            });
          },
        };
      },
    },
    'require-security-suppression-reason': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Require security-lint suppression comments to include a short reason.',
        },
        schema: [],
        messages: {
          missingReason:
            'Security lint suppression "{{ marker }}" must include a short "reason:" explanation.',
        },
      },
      create(context) {
        const markers = [
          'security-lint-ok: public',
          'security-lint-ok: public-query',
          'security-lint-ok: no-rate-limit-needed',
          'security-lint-ok: site-admin-not-required',
        ];

        return {
          CallExpression(node) {
            if (!isPublicBuilderCall(node)) {
              return;
            }

            const handler = getHandlerNode(node);
            const sourceText = getHandlerSourceText(context, handler);
            if (!sourceText) {
              return;
            }

            for (const marker of markers) {
              if (hasSuppressionReason(sourceText, marker)) {
                continue;
              }

              context.report({
                node: handler,
                messageId: 'missingReason',
                data: { marker },
              });
            }
          },
        };
      },
    },
    'require-http-route-guards': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Require explicit verification guards on sensitive Convex HTTP routes.',
        },
        schema: [],
        messages: {
          missingHttpGuard:
            'HTTP route "{{ path }}" is missing the expected security guard. Add {{ expected }} or mark it with "security-lint-ok: public reason: ...".',
        },
      },
      create(context) {
        const filename = context.filename ?? context.getFilename?.() ?? '';
        if (!filename.endsWith('/convex/http.ts') && !filename.endsWith('\\convex\\http.ts')) {
          return {};
        }

        const expectationsByPath = new Map([
          ['/webhooks/resend', 'resend.handleResendEventWebhook'],
          ['/aws/guardduty-malware', 'verifyWebhookSignature'],
          ['/api/files/serve', 'verifyFileServeSignature'],
        ]);

        return {
          CallExpression(node) {
            const config = getHttpRouteConfig(node);
            if (!config) {
              return;
            }

            const path = getStaticStringProperty(config, 'path');
            if (!path || !expectationsByPath.has(path)) {
              return;
            }

            const handler = getObjectPropertyValue(config, 'handler');
            const sourceText = getHandlerSourceText(context, handler);
            if (!sourceText) {
              return;
            }

            if (
              sourceText.includes('security-lint-ok: public') &&
              hasSuppressionReason(sourceText, 'security-lint-ok: public')
            ) {
              return;
            }

            const expected = expectationsByPath.get(path);
            if (expected && sourceText.includes(expected)) {
              return;
            }

            context.report({
              node: handler,
              messageId: 'missingHttpGuard',
              data: { path, expected },
            });
          },
        };
      },
    },
    'require-strong-guards-in-sensitive-queries': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Require stronger non-anonymous auth or authorization guards on sensitive public queries.',
        },
        schema: [],
        messages: {
          weakSensitiveQueryGuard:
            'Sensitive query "{{ name }}" must use a strong auth/authorization guard and may not rely on anonymous-safe helpers or "security-lint-ok: public-query".',
        },
      },
      create(context) {
        return {
          CallExpression(node) {
            if (!isPublicHandlerCall(node, 'query')) {
              return;
            }

            const exportName = getPublicExportName(node);
            if (!exportName || !SENSITIVE_QUERY_EXPORT_NAMES.has(exportName)) {
              return;
            }

            const handler = getHandlerNode(node);
            const sourceText = getHandlerSourceText(context, handler);
            if (!sourceText) {
              return;
            }

            if (SENSITIVE_QUERY_DISALLOWED_PATTERNS.some((pattern) => pattern.test(sourceText))) {
              context.report({
                node: handler,
                messageId: 'weakSensitiveQueryGuard',
                data: { name: exportName },
              });
              return;
            }

            if (SENSITIVE_QUERY_STRONG_GUARD_PATTERNS.some((pattern) => pattern.test(sourceText))) {
              return;
            }

            context.report({
              node: handler,
              messageId: 'weakSensitiveQueryGuard',
              data: { name: exportName },
            });
          },
        };
      },
    },
  },
};
