import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';
import { Download, FileText } from 'lucide-react';
import { useState } from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '~/components/ui/accordion';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '~/components/ui/dialog';
import { SheetDescription, SheetHeader, SheetTitle } from '~/components/ui/sheet';
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
  onOpenControl: (internalControlId: string) => void;
  policy: SecurityPolicyDetail;
}) {
  const { policy } = props;
  const [isSourceOpen, setIsSourceOpen] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const hasSourceMarkdown =
    typeof policy.sourceMarkdown === 'string' && policy.sourceMarkdown.length > 0;

  async function handleDownloadPdf() {
    const sourceMarkdown = policy.sourceMarkdown;
    if (typeof sourceMarkdown !== 'string' || sourceMarkdown.length === 0) {
      return;
    }

    setIsDownloadingPdf(true);
    try {
      const response = await fetch('/api/security-policy-pdf', {
        body: JSON.stringify({
          fileName: getPolicyPdfFileName(policy.title),
          markdownContent: sourceMarkdown,
          sourcePath: policy.sourcePath,
          title: policy.title,
        }),
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error((await response.text()) || 'Failed to generate policy PDF');
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get('Content-Disposition');
      const resolvedFileName = getFileNameFromDisposition(
        contentDisposition,
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
      setIsDownloadingPdf(false);
    }
  }

  return (
    <>
      <SheetHeader className="border-b">
        <div className="flex items-start justify-between gap-4 pr-12">
          <div className="space-y-1">
            <SheetTitle>{policy.title}</SheetTitle>
            <SheetDescription>{policy.summary}</SheetDescription>
          </div>
          <Badge variant={getSupportBadgeVariant(policy.support)}>
            {formatSupportStatus(policy.support)}
          </Badge>
        </div>
      </SheetHeader>

      <div className="space-y-6 p-4">
        <DetailSection title="Overview">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2">
            <DetailItem label="Policy owner" value={policy.owner} />
            <DetailItem
              label="Policy last reviewed"
              value={
                policy.lastReviewedAt
                  ? new Date(policy.lastReviewedAt).toLocaleString()
                  : 'No completed review recorded'
              }
            />
            <DetailItem
              label="Next review"
              value={
                policy.nextReviewAt
                  ? new Date(policy.nextReviewAt).toLocaleDateString()
                  : 'No next review scheduled'
              }
            />
          </dl>
        </DetailSection>

        <DetailSection title="Policy source">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!hasSourceMarkdown}
                onClick={() => {
                  setIsSourceOpen(true);
                }}
              >
                <FileText className="size-4" />
                View policy
              </Button>
            </div>
            {!hasSourceMarkdown ? (
              <p className="text-sm text-muted-foreground">
                No bundled markdown source is available for this policy.
              </p>
            ) : null}
          </div>
        </DetailSection>

        <DetailSection title="Annual review linkage">
          {policy.linkedAnnualReviewTask ? (
            <div className="space-y-1">
              <p className="text-sm text-foreground">{policy.linkedAnnualReviewTask.title}</p>
              <p className="text-sm text-muted-foreground">
                Status: {policy.linkedAnnualReviewTask.status.replaceAll('_', ' ')}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No annual review task is linked yet.</p>
          )}
        </DetailSection>

        <DetailSection title="Mapped controls">
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
      </div>

      <Dialog open={isSourceOpen} onOpenChange={setIsSourceOpen}>
        <DialogContent className="grid max-h-[90vh] max-w-4xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-0">
          <DialogHeader className="border-b px-6 py-4 pr-14">
            <div className="flex items-center justify-between gap-4">
              <DialogTitle>{policy.title}</DialogTitle>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!hasSourceMarkdown || isDownloadingPdf}
                onClick={() => {
                  void handleDownloadPdf();
                }}
              >
                <Download className="size-4" />
                {isDownloadingPdf ? 'Generating PDF…' : 'Download PDF'}
              </Button>
            </div>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto px-6 py-4">
            <SecurityPolicyMarkdownRenderer
              bare
              content={policy.sourceMarkdown ?? 'No bundled markdown source is available.'}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function getPolicyPdfFileName(title: string) {
  const sanitizedTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const date = new Date().toISOString().split('T')[0];
  return `${sanitizedTitle || 'policy-document'}-${date}.pdf`;
}

function getFileNameFromDisposition(
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
      return <p className="text-sm text-muted-foreground">Loading checklist…</p>;
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

function DetailSection(props: { children: React.ReactNode; title: string }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{props.title}</h3>
      {props.children}
    </section>
  );
}

function DetailItem(props: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {props.label}
      </dt>
      <dd className="text-sm text-foreground">{props.value}</dd>
    </div>
  );
}
