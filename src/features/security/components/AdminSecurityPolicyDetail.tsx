import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';
import { ChevronDown, Download } from 'lucide-react';
import { useState } from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '~/components/ui/accordion';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/collapsible';
import { SheetDescription, SheetHeader, SheetTitle } from '~/components/ui/sheet';
import { Spinner } from '~/components/ui/spinner';
import {
  formatChecklistStatus,
  formatSupportStatus,
  getChecklistStatusBadgeVariant,
  getSupportBadgeVariant,
} from '~/features/security/formatters';
import { SecurityChecklistReadOnlySection } from '~/features/security/components/SecurityChecklistReadOnly';
import { SecurityPolicyMarkdownRenderer } from '~/features/security/components/SecurityPolicyMarkdownRenderer';
import type {
  SecurityControlWorkspace,
  SecurityPolicyControlMapping,
  SecurityPolicyDetail,
} from '~/features/security/types';

export function AdminSecurityPolicyDetail(props: {
  children?: React.ReactNode;
  onOpenControl: (internalControlId: string) => void;
  policy: SecurityPolicyDetail;
  /** Slot rendered after Controls — used by the Reviews route for the review status section */
  reviewStatusSlot?: React.ReactNode;
}) {
  const { policy } = props;

  return (
    <>
      <SheetHeader className="border-b">
        <div className="flex items-start justify-between gap-4 pr-12">
          <div className="space-y-1">
            <SheetTitle>{policy.title}</SheetTitle>
            <SheetDescription>{policy.summary}</SheetDescription>
            {policy.owner ? (
              <p className="text-xs text-muted-foreground">Owner: {policy.owner}</p>
            ) : null}
          </div>
          <Badge variant={getSupportBadgeVariant(policy.support)}>
            {formatSupportStatus(policy.support)}
          </Badge>
        </div>
      </SheetHeader>

      <div className="space-y-6 p-4">
        {props.children}

        <DetailSection title="Controls">
          <p className="text-sm text-muted-foreground">
            Policy support is derived only from these mapped control support states.
          </p>
          {policy.mappedControls.length > 0 ? (
            <Accordion type="multiple" className="rounded-md border">
              {policy.mappedControls.map((control) => (
                <AccordionItem
                  key={`${policy.policyId}:${control.internalControlId}`}
                  value={control.internalControlId}
                  className="border-b last:border-b-0"
                >
                  <AccordionTrigger className="px-5 py-4 text-left focus-visible:border-transparent focus-visible:ring-1 focus-visible:ring-border/70 data-[state=open]:bg-muted/20">
                    <div className="flex flex-1 items-start justify-between gap-4 pr-4">
                      <p className="text-sm font-medium">
                        {control.nist80053Id} {control.title}
                      </p>
                      <Badge variant={getSupportBadgeVariant(control.support)}>
                        {formatSupportStatus(control.support)}
                      </Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-4 px-4 pb-4">
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {control.implementationSummary ?? 'No implementation summary recorded.'}
                    </p>
                    <div className="space-y-3">
                      <p className="text-sm font-medium">Checklist</p>
                      <PolicyMappedControlChecklist control={control} />
                    </div>
                    <div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          props.onOpenControl(control.internalControlId);
                        }}
                      >
                        Open control
                      </Button>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          ) : (
            <p className="text-sm text-muted-foreground">No mapped controls recorded yet.</p>
          )}
        </DetailSection>

        {props.reviewStatusSlot ?? <PolicyReviewStatusReadOnly policy={policy} />}
      </div>
    </>
  );
}

export function PolicySourceCollapsible(props: { policy: SecurityPolicyDetail }) {
  const { policy } = props;
  const [isDownloading, setIsDownloading] = useState(false);

  async function handleDownloadPdf(e: React.MouseEvent) {
    e.stopPropagation();
    const sourceMarkdown = policy.sourceMarkdown;
    if (typeof sourceMarkdown !== 'string' || sourceMarkdown.length === 0) return;

    setIsDownloading(true);
    try {
      const response = await fetch('/api/security-policy-pdf', {
        body: JSON.stringify({
          fileName: getPolicyPdfFileName(policy.title),
          markdownContent: sourceMarkdown,
          sourcePath: policy.sourcePath,
          title: policy.title,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error((await response.text()) || 'Failed to generate policy PDF');
      }
      const blob = await response.blob();
      const resolvedFileName = getFileNameFromDisposition(
        response.headers.get('Content-Disposition'),
        getPolicyPdfFileName(policy.title),
      );
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = resolvedFileName;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(url);
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Policy</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isDownloading}
          onClick={(e) => void handleDownloadPdf(e)}
        >
          <Download className="size-4" />
          {isDownloading ? 'Generating PDF…' : 'Download PDF'}
        </Button>
      </div>
      <Collapsible className="rounded-md border">
        <CollapsibleTrigger className="flex w-full items-center justify-between px-5 py-4 text-left text-sm font-medium hover:bg-muted/20 focus-visible:border-transparent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border/70 [&[data-state=open]>svg]:rotate-180">
          View policy document
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200" />
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t px-4 pb-4 pt-4">
          <SecurityPolicyMarkdownRenderer bare content={policy.sourceMarkdown!} />
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}

export function getPolicyPdfFileName(title: string) {
  const sanitizedTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const date = new Date().toISOString().split('T')[0];
  return `${sanitizedTitle || 'policy-document'}-${date}.pdf`;
}

export function getFileNameFromDisposition(
  contentDispositionHeader: string | null,
  fallbackFileName: string,
) {
  if (!contentDispositionHeader) {
    return fallbackFileName;
  }
  const matches = contentDispositionHeader.match(/filename="?([^";]+)"?/);
  return matches?.[1] || fallbackFileName;
}

function PolicyMappedControlChecklist(props: { control: SecurityPolicyControlMapping }) {
  const control = useQuery(api.securityWorkspace.getSecurityControlWorkspaceDetail, {
    internalControlId: props.control.internalControlId,
  }) as SecurityControlWorkspace | null | undefined;

  if (control === undefined) {
    if (props.control.platformChecklist.length === 0) {
      return (
        <div className="flex min-h-20 items-center justify-center rounded-md border border-dashed bg-muted/20 text-sm text-muted-foreground">
          <Spinner className="size-5" />
          <span className="sr-only">Loading checklist</span>
        </div>
      );
    }

    return (
      <div className="space-y-2 rounded-md border">
        {props.control.platformChecklist.map((item) => (
          <div
            key={`${props.control.internalControlId}:${item.itemId}`}
            className="flex items-center justify-between gap-3 border-b px-3 py-2 last:border-b-0"
          >
            <p className="text-sm">{item.label}</p>
            <Badge variant={getChecklistStatusBadgeVariant(item.support)}>
              {formatChecklistStatus(item.support)}
            </Badge>
          </div>
        ))}
      </div>
    );
  }

  if (control === null) {
    return <p className="text-sm text-muted-foreground">Checklist details are unavailable.</p>;
  }

  return <SecurityChecklistReadOnlySection items={control.platformChecklist} />;
}

function PolicyReviewStatusReadOnly(props: { policy: SecurityPolicyDetail }) {
  const { policy } = props;
  const task = policy.linkedAnnualReviewTask;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Reviews</h3>
        {task ? (
          <Badge
            variant={
              task.status === 'completed'
                ? 'success'
                : task.status === 'exception'
                  ? 'warning'
                  : task.status === 'blocked'
                    ? 'destructive'
                    : 'secondary'
            }
          >
            {task.status === 'ready'
              ? 'Needs attestation'
              : task.status.charAt(0).toUpperCase() + task.status.slice(1)}
          </Badge>
        ) : null}
      </div>

      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Next review
          </dt>
          <dd className="text-sm text-foreground">
            {policy.nextReviewAt
              ? new Date(policy.nextReviewAt).toLocaleDateString()
              : 'Not scheduled'}
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Review cycle
          </dt>
          <dd className="text-sm text-foreground">Annual</dd>
        </div>
      </dl>
    </section>
  );
}

function DetailSection(props: { children: React.ReactNode; title: string }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{props.title}</h3>
      {props.children}
    </section>
  );
}
