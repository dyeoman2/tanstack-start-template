import { Badge } from '~/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip';
import {
  formatControlResponsibility,
  formatSupportStatus,
  formatHipaaMapping,
  getEvidenceProgress,
  getSupportBadgeVariant,
  getResponsibilityBadgeVariant,
} from '~/features/security/formatters';
import type { SecurityControlWorkspaceSummary } from '~/features/security/types';

export function AdminSecurityControlCell(props: { control: SecurityControlWorkspaceSummary }) {
  const { control } = props;

  return (
    <div className="min-w-0 py-1">
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="text-left">
              <p className="font-medium text-foreground">
                {control.nist80053Id} {control.title}
              </p>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" align="start" className="max-w-md">
            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-foreground/80">
                  Ownership
                </p>
                <p className="text-sm font-medium">{control.owner}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-foreground/80">
                  Control summary
                </p>
                <p className="text-xs leading-relaxed">{control.implementationSummary}</p>
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

export function AdminSecurityResponsibilityCell(props: {
  control: SecurityControlWorkspaceSummary;
}) {
  const { control } = props;

  if (!control.responsibility) {
    return <div className="py-1 text-sm text-muted-foreground">—</div>;
  }

  const badge = (
    <Badge variant={getResponsibilityBadgeVariant(control.responsibility)}>
      {formatControlResponsibility(control.responsibility)}
    </Badge>
  );

  return (
    <div className="space-y-2 py-1">
      {control.customerResponsibilityNotes ? (
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>{badge}</TooltipTrigger>
            <TooltipContent side="top" align="start" className="max-w-sm">
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-foreground/80">
                  Customer responsibilities
                </p>
                <p className="text-xs leading-relaxed">{control.customerResponsibilityNotes}</p>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        badge
      )}
    </div>
  );
}

export function AdminSecuritySupportCell(props: { control: SecurityControlWorkspaceSummary }) {
  const { control } = props;
  const progress = getEvidenceProgress(control);

  return (
    <div className="py-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={getSupportBadgeVariant(control.support)}>
          {formatSupportStatus(control.support)} {progress.label}
        </Badge>
        {control.hasExpiringSoonEvidence ? (
          <span className="text-xs text-amber-600 font-medium">⚠ Expiring</span>
        ) : null}
      </div>
    </div>
  );
}

export function AdminSecurityFrameworkSummaryCell(props: {
  control: SecurityControlWorkspaceSummary;
}) {
  const { control } = props;
  const frameworkSummaries = [
    {
      label: 'HIPAA',
      count: control.mappings.hipaa.length,
      values: control.mappings.hipaa.map((mapping) => formatHipaaMapping(mapping)),
    },
    {
      label: 'CSF',
      count: control.mappings.csf20.length,
      values: control.mappings.csf20.map(
        (mapping) => `${mapping.subcategoryId}${mapping.label ? ` · ${mapping.label}` : ''}`,
      ),
    },
    {
      label: 'NIST 800-66r2',
      count: control.mappings.nist80066.length,
      values: control.mappings.nist80066.map((mapping) => mapping.referenceId),
    },
    {
      label: 'SOC 2',
      count: control.mappings.soc2.length,
      values: control.mappings.soc2.map(
        (mapping) => `${mapping.criterionId}${mapping.label ? ` · ${mapping.label}` : ''}`,
      ),
    },
  ].filter((item) => item.count > 0);

  return (
    <div className="py-1 text-sm text-muted-foreground">
      <div className="flex flex-wrap gap-2">
        {frameworkSummaries.map((item) => (
          <TooltipProvider key={item.label} delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="rounded-full border px-2 py-1 text-xs font-medium text-foreground"
                >
                  {item.label} ({item.count})
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" align="start" className="max-w-md">
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-foreground/80">
                    {item.label} mappings
                  </p>
                  <ul className="list-disc space-y-1 pl-4 text-left text-xs leading-relaxed">
                    {item.values.map((value) => (
                      <li key={value}>{value}</li>
                    ))}
                  </ul>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ))}
      </div>
    </div>
  );
}
