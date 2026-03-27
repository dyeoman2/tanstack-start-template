import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';
import { Archive, Check, History, MoreHorizontal, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/collapsible';
import { AddEvidenceDialog } from '~/features/security/components/AddEvidenceDialog';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '~/components/ui/accordion';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { DeleteConfirmationDialog } from '~/components/ui/delete-confirmation-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { SheetDescription, SheetHeader, SheetTitle } from '~/components/ui/sheet';
import { Spinner } from '~/components/ui/spinner';
import {
  Accordion as MappingAccordion,
  AccordionContent as MappingAccordionContent,
  AccordionItem as MappingAccordionItem,
  AccordionTrigger as MappingAccordionTrigger,
} from '~/components/ui/accordion';
import {
  SecurityChecklistAccordionHeader,
  SecurityChecklistItemReadOnlyContent,
} from '~/features/security/components/SecurityChecklistReadOnly';
import {
  formatControlResponsibility,
  formatEvidenceActivityEvent,
  formatEvidenceLifecycleStatus,
  formatEvidenceReviewStatus,
  formatEvidenceSufficiency,
  formatEvidenceTimestamp,
  formatHipaaMapping,
  formatSupportStatus,
  getEvidenceLifecycleBadgeVariant,
  getEvidenceReviewBadgeVariant,
  getEvidenceSufficiencyBadgeVariant,
  getSupportBadgeVariant,
} from '~/features/security/formatters';
import type {
  EvidenceReviewDueIntervalMonths,
  EvidenceSource,
  SecurityChecklistEvidence,
  SecurityChecklistEvidenceActivity,
  SecurityChecklistItem,
  SecurityControlWorkspace,
} from '~/features/security/types';

export function AdminSecurityControlDetail(props: {
  busyAction: string | null;
  control: SecurityControlWorkspace;
  onAddEvidenceLink: (args: {
    description?: string;
    evidenceDate: number;
    internalControlId: string;
    itemId: string;
    reviewDueIntervalMonths: EvidenceReviewDueIntervalMonths;
    source: EvidenceSource;
    sufficiency: SecurityChecklistEvidence['sufficiency'];
    title: string;
    url: string;
  }) => Promise<void>;
  onAddEvidenceNote: (args: {
    description: string;
    evidenceDate: number;
    internalControlId: string;
    itemId: string;
    reviewDueIntervalMonths: EvidenceReviewDueIntervalMonths;
    source: EvidenceSource;
    sufficiency: SecurityChecklistEvidence['sufficiency'];
    title: string;
  }) => Promise<void>;
  onArchiveEvidence: (args: {
    evidenceId: string;
    internalControlId: string;
    itemId: string;
  }) => Promise<void>;
  onOpenEvidence: (evidence: SecurityChecklistEvidence) => Promise<void>;
  onOpenLinkedEntity: (entity: SecurityControlWorkspace['linkedEntities'][number]) => void;
  onOpenReviews: () => void;
  onReviewEvidence: (args: { evidenceId: string }) => Promise<void>;
  onRenewEvidence: (args: {
    evidenceId: string;
    internalControlId: string;
    itemId: string;
  }) => Promise<void>;
  onUploadEvidenceFile: (args: {
    description?: string;
    evidenceDate: number;
    file: File;
    internalControlId: string;
    itemId: string;
    reviewDueIntervalMonths: EvidenceReviewDueIntervalMonths;
    source: EvidenceSource;
    sufficiency: SecurityChecklistEvidence['sufficiency'];
    title: string;
  }) => Promise<void>;
}) {
  const { control } = props;

  return (
    <>
      <SheetHeader className="border-b">
        <div className="flex items-start justify-between gap-4 pr-12">
          <div className="space-y-1">
            <SheetTitle>
              {control.nist80053Id} {control.title}
            </SheetTitle>
            <SheetDescription>{control.familyTitle}</SheetDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={getSupportBadgeVariant(control.support)}>
              {formatSupportStatus(control.support)}
            </Badge>
            {control.hasExpiringSoonEvidence ? (
              <Badge variant="secondary">Expiring soon</Badge>
            ) : null}
          </div>
        </div>
      </SheetHeader>

      <div className="space-y-6 p-4">
        <DetailSection title="Evidence checklist">
          <PlatformChecklistSection
            busyAction={props.busyAction}
            control={control}
            onAddEvidenceLink={props.onAddEvidenceLink}
            onAddEvidenceNote={props.onAddEvidenceNote}
            onArchiveEvidence={props.onArchiveEvidence}
            onOpenEvidence={props.onOpenEvidence}
            onOpenReviews={props.onOpenReviews}
            onReviewEvidence={props.onReviewEvidence}
            onRenewEvidence={props.onRenewEvidence}
            onUploadEvidenceFile={props.onUploadEvidenceFile}
          />
        </DetailSection>

        <DetailSection title="Overview">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2">
            <DetailItem
              label="Responsibility"
              value={formatControlResponsibility(control.responsibility)}
            />
            <DetailItem label="Control owner" value={control.owner} />
            <DetailItem
              label="Control last reviewed"
              value={
                control.lastReviewedAt
                  ? formatEvidenceTimestamp(control.lastReviewedAt)
                  : 'No completed review recorded'
              }
            />
          </dl>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {control.implementationSummary}
          </p>
        </DetailSection>

        <DetailSection title="Linked governance context">
          {control.linkedEntities.length ? (
            <div className="flex flex-wrap gap-2">
              {control.linkedEntities.map((entity) => (
                <Button
                  key={`${entity.entityType}:${entity.entityId}`}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    props.onOpenLinkedEntity(entity);
                  }}
                >
                  {entity.label}
                  {entity.status ? ` · ${entity.status.replaceAll('_', ' ')}` : ''}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No linked vendors, findings, review tasks, or reports are recorded yet.
            </p>
          )}
        </DetailSection>

        <CollapsibleDetailSection title="More details">
          <DetailSection title="Customer responsibilities">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {control.customerResponsibilityNotes ??
                'No additional customer responsibilities recorded.'}
            </p>
          </DetailSection>

          <DetailSection title="Framework mappings">
            <MappingAccordion type="multiple" className="rounded-md border">
              <FrameworkAccordionItem
                title="HIPAA"
                value="hipaa"
                values={control.mappings.hipaa.map((mapping) => formatHipaaMapping(mapping))}
              />
              <FrameworkAccordionItem
                title="CSF 2.0"
                value="csf"
                values={control.mappings.csf20.map(
                  (mapping) =>
                    `${mapping.subcategoryId}${mapping.label ? ` · ${mapping.label}` : ''}`,
                )}
              />
              <FrameworkAccordionItem
                title="NIST 800-66r2"
                value="nist-800-66r2"
                values={control.mappings.nist80066.map(
                  (mapping) =>
                    `${mapping.referenceId}${mapping.label ? ` · ${mapping.label}` : ''}`,
                )}
              />
              <FrameworkAccordionItem
                title="SOC 2"
                value="soc2"
                values={control.mappings.soc2.map(
                  (mapping) =>
                    `${mapping.criterionId}${mapping.label ? ` · ${mapping.label}` : ''}`,
                )}
              />
            </MappingAccordion>
          </DetailSection>
        </CollapsibleDetailSection>
      </div>
    </>
  );
}

function PlatformChecklistSection(props: {
  busyAction: string | null;
  control: SecurityControlWorkspace;
  onAddEvidenceLink: (args: {
    description?: string;
    evidenceDate: number;
    internalControlId: string;
    itemId: string;
    reviewDueIntervalMonths: EvidenceReviewDueIntervalMonths;
    source: EvidenceSource;
    sufficiency: SecurityChecklistEvidence['sufficiency'];
    title: string;
    url: string;
  }) => Promise<void>;
  onAddEvidenceNote: (args: {
    description: string;
    evidenceDate: number;
    internalControlId: string;
    itemId: string;
    reviewDueIntervalMonths: EvidenceReviewDueIntervalMonths;
    source: EvidenceSource;
    sufficiency: SecurityChecklistEvidence['sufficiency'];
    title: string;
  }) => Promise<void>;
  onArchiveEvidence: (args: {
    evidenceId: string;
    internalControlId: string;
    itemId: string;
  }) => Promise<void>;
  onOpenEvidence: (evidence: SecurityChecklistEvidence) => Promise<void>;
  onOpenReviews: () => void;
  onReviewEvidence: (args: { evidenceId: string }) => Promise<void>;
  onRenewEvidence: (args: {
    evidenceId: string;
    internalControlId: string;
    itemId: string;
  }) => Promise<void>;
  onUploadEvidenceFile: (args: {
    description?: string;
    evidenceDate: number;
    file: File;
    internalControlId: string;
    itemId: string;
    reviewDueIntervalMonths: EvidenceReviewDueIntervalMonths;
    source: EvidenceSource;
    sufficiency: SecurityChecklistEvidence['sufficiency'];
    title: string;
  }) => Promise<void>;
}) {
  return (
    <Accordion type="multiple" className="rounded-md border">
      {props.control.platformChecklist.map((item) => (
        <ChecklistItemActions
          key={item.itemId}
          busyAction={props.busyAction}
          control={props.control}
          item={item}
          onAddEvidenceLink={props.onAddEvidenceLink}
          onAddEvidenceNote={props.onAddEvidenceNote}
          onArchiveEvidence={props.onArchiveEvidence}
          onOpenEvidence={props.onOpenEvidence}
          onOpenReviews={props.onOpenReviews}
          onReviewEvidence={props.onReviewEvidence}
          onRenewEvidence={props.onRenewEvidence}
          onUploadEvidenceFile={props.onUploadEvidenceFile}
        />
      ))}
    </Accordion>
  );
}

function ChecklistItemActions(props: {
  busyAction: string | null;
  control: SecurityControlWorkspace;
  item: SecurityChecklistItem;
  onAddEvidenceLink: (args: {
    description?: string;
    evidenceDate: number;
    internalControlId: string;
    itemId: string;
    reviewDueIntervalMonths: EvidenceReviewDueIntervalMonths;
    source: EvidenceSource;
    sufficiency: SecurityChecklistEvidence['sufficiency'];
    title: string;
    url: string;
  }) => Promise<void>;
  onAddEvidenceNote: (args: {
    description: string;
    evidenceDate: number;
    internalControlId: string;
    itemId: string;
    reviewDueIntervalMonths: EvidenceReviewDueIntervalMonths;
    source: EvidenceSource;
    sufficiency: SecurityChecklistEvidence['sufficiency'];
    title: string;
  }) => Promise<void>;
  onArchiveEvidence: (args: {
    evidenceId: string;
    internalControlId: string;
    itemId: string;
  }) => Promise<void>;
  onOpenEvidence: (evidence: SecurityChecklistEvidence) => Promise<void>;
  onOpenReviews: () => void;
  onReviewEvidence: (args: { evidenceId: string }) => Promise<void>;
  onRenewEvidence: (args: {
    evidenceId: string;
    internalControlId: string;
    itemId: string;
  }) => Promise<void>;
  onUploadEvidenceFile: (args: {
    description?: string;
    evidenceDate: number;
    file: File;
    internalControlId: string;
    itemId: string;
    reviewDueIntervalMonths: EvidenceReviewDueIntervalMonths;
    source: EvidenceSource;
    sufficiency: SecurityChecklistEvidence['sufficiency'];
    title: string;
  }) => Promise<void>;
}) {
  const { control, item } = props;
  const [isAddingProof, setIsAddingProof] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [pendingArchiveEvidence, setPendingArchiveEvidence] =
    useState<SecurityChecklistEvidence | null>(null);
  const [pendingRenewEvidence, setPendingRenewEvidence] =
    useState<SecurityChecklistEvidence | null>(null);
  const linkKey = `${control.internalControlId}:${item.itemId}:link`;
  const noteKey = `${control.internalControlId}:${item.itemId}:note`;
  const historyEvidence = item.evidence.filter((evidence) => evidence.lifecycleStatus !== 'active');
  const evidenceActivity = useQuery(
    api.securityWorkspace.listSecurityControlEvidenceActivity,
    isHistoryOpen
      ? {
          internalControlId: control.internalControlId,
          itemId: item.itemId,
        }
      : 'skip',
  );
  return (
    <>
      <AccordionItem value={item.itemId} className="border-b last:border-b-0">
        <AccordionTrigger className="px-5 py-4 text-left focus-visible:border-transparent focus-visible:ring-1 focus-visible:ring-border/70 data-[state=open]:bg-muted/20">
          <SecurityChecklistAccordionHeader item={item} />
        </AccordionTrigger>
        <AccordionContent className="px-4 pb-4">
          <SecurityChecklistItemReadOnlyContent
            item={item}
            onOpenEvidence={props.onOpenEvidence}
            onOpenReviews={props.onOpenReviews}
            renderEvidenceActions={(evidence) => (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Evidence actions for ${evidence.title}`}
                    title="Evidence actions"
                    disabled={
                      props.busyAction === `${evidence.id}:archive` ||
                      props.busyAction === `${evidence.id}:renew`
                    }
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {!evidence.id.includes(':seed:') && evidence.reviewStatus === 'pending' ? (
                    <DropdownMenuItem
                      disabled={props.busyAction === `${evidence.id}:review`}
                      onSelect={() => {
                        void props.onReviewEvidence({
                          evidenceId: evidence.id,
                        });
                      }}
                    >
                      <Check className="size-4" />
                      Approve
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem
                    onSelect={() => {
                      setPendingArchiveEvidence(evidence);
                    }}
                  >
                    <Archive className="size-4" />
                    Archive
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      setPendingRenewEvidence(evidence);
                    }}
                  >
                    <RefreshCw className="size-4" />
                    Renew
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          >
            <div className="flex flex-wrap justify-start gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsAddingProof(true)}
              >
                Add evidence
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsHistoryOpen(true)}
              >
                <History className="size-4" />
                Evidence history
              </Button>
            </div>
          </SecurityChecklistItemReadOnlyContent>
        </AccordionContent>
      </AccordionItem>

      <AddEvidenceDialog
        busyKey={props.busyAction}
        description={`${item.label}. Suggested evidence: ${item.suggestedEvidenceTypes.join(', ')}`}
        linkBusyKey={linkKey}
        noteBusyKey={noteKey}
        onAddLink={async (payload) => {
          await props.onAddEvidenceLink({
            ...payload,
            internalControlId: control.internalControlId,
            itemId: item.itemId,
          });
        }}
        onAddNote={async (payload) => {
          await props.onAddEvidenceNote({
            ...payload,
            internalControlId: control.internalControlId,
            itemId: item.itemId,
          });
        }}
        onUploadFile={async (payload) => {
          await props.onUploadEvidenceFile({
            ...payload,
            internalControlId: control.internalControlId,
            itemId: item.itemId,
          });
        }}
        open={isAddingProof}
        onOpenChange={setIsAddingProof}
      />

      <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Evidence history</DialogTitle>
            <DialogDescription>{item.label}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {historyEvidence.length ? (
              <>
                <div className="space-y-2">
                  {historyEvidence.map((evidence) => (
                    <div key={evidence.id} className="space-y-3 rounded-md border px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="min-w-0 flex-1 text-sm font-medium">{evidence.title}</p>
                        <div className="flex items-center gap-2">
                          <Badge variant={getEvidenceSufficiencyBadgeVariant(evidence.sufficiency)}>
                            {formatEvidenceSufficiency(evidence.sufficiency)}
                          </Badge>
                          <Badge
                            variant={getEvidenceLifecycleBadgeVariant(evidence.lifecycleStatus)}
                          >
                            {formatEvidenceLifecycleStatus(evidence.lifecycleStatus)}
                          </Badge>
                          <Badge variant={getEvidenceReviewBadgeVariant(evidence.reviewStatus)}>
                            {formatEvidenceReviewStatus(evidence.reviewStatus)}
                          </Badge>
                        </div>
                      </div>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <p>
                          <span className="font-medium text-foreground">Added:</span>{' '}
                          {`${evidence.uploadedByDisplay ?? 'Unknown'} · ${formatEvidenceTimestamp(evidence.createdAt)}`}
                        </p>
                        <p>
                          <span className="font-medium text-foreground">Reviewed:</span>{' '}
                          {evidence.reviewedAt
                            ? `${evidence.reviewedByDisplay ?? 'Not recorded'} · ${formatEvidenceTimestamp(evidence.reviewedAt)}`
                            : 'Not reviewed'}
                        </p>
                        <p>
                          <span className="font-medium text-foreground">
                            {evidence.lifecycleStatus === 'superseded'
                              ? 'Superseded:'
                              : 'Archived:'}
                          </span>{' '}
                          {evidence.archivedAt
                            ? `${evidence.archivedByDisplay ?? 'Not recorded'} · ${formatEvidenceTimestamp(evidence.archivedAt)}`
                            : 'Not recorded'}
                        </p>
                      </div>
                      {evidence.evidenceType !== 'note' ? (
                        <div className="flex justify-start">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void props.onOpenEvidence(evidence)}
                          >
                            Open
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No archived evidence yet.</p>
            )}
            <div className="space-y-3">
              <p className="text-sm font-medium">Activity</p>
              {evidenceActivity === undefined ? (
                <div className="flex min-h-20 items-center justify-center rounded-md border border-dashed bg-muted/20 text-sm text-muted-foreground">
                  <Spinner className="size-5" />
                  <span className="sr-only">Loading activity</span>
                </div>
              ) : evidenceActivity.length > 0 ? (
                <div className="space-y-2">
                  {evidenceActivity.map((event: SecurityChecklistEvidenceActivity) => (
                    <div key={event.id} className="space-y-1 rounded-md border px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium">
                          {formatEvidenceActivityEvent(event.eventType)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatEvidenceTimestamp(event.createdAt)}
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {event.actorDisplay ?? 'Unknown'} · {event.evidenceTitle}
                      </p>
                      {event.eventType === 'security_control_evidence_renewed' &&
                      event.renewedFromEvidenceId ? (
                        <p className="text-xs text-muted-foreground">
                          Renewed from {event.renewedFromEvidenceId}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No activity yet.</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <DeleteConfirmationDialog
        open={pendingArchiveEvidence !== null}
        onClose={() => setPendingArchiveEvidence(null)}
        title="Archive evidence?"
        description={
          pendingArchiveEvidence
            ? `${pendingArchiveEvidence.title} will be removed from the active checklist and kept in evidence history.`
            : 'This will archive the selected evidence item and preserve it in history.'
        }
        deleteText="Archive evidence"
        isDeleting={
          pendingArchiveEvidence
            ? props.busyAction === `${pendingArchiveEvidence.id}:archive`
            : false
        }
        pendingText="Archiving..."
        onConfirm={() => {
          if (!pendingArchiveEvidence) {
            return;
          }
          void props
            .onArchiveEvidence({
              evidenceId: pendingArchiveEvidence.id,
              internalControlId: control.internalControlId,
              itemId: item.itemId,
            })
            .then(() => {
              setPendingArchiveEvidence(null);
            });
        }}
      />

      <DeleteConfirmationDialog
        open={pendingRenewEvidence !== null}
        onClose={() => setPendingRenewEvidence(null)}
        title="Renew evidence?"
        description={
          pendingRenewEvidence
            ? `${pendingRenewEvidence.title} will be duplicated with a new added timestamp for now, its review metadata will be cleared, and the current evidence will move to history.`
            : 'This will create a renewed copy and archive the current evidence.'
        }
        deleteText="Renew evidence"
        isDeleting={
          pendingRenewEvidence ? props.busyAction === `${pendingRenewEvidence.id}:renew` : false
        }
        pendingText="Renewing..."
        onConfirm={() => {
          if (!pendingRenewEvidence) {
            return;
          }
          void props
            .onRenewEvidence({
              evidenceId: pendingRenewEvidence.id,
              internalControlId: control.internalControlId,
              itemId: item.itemId,
            })
            .then(() => {
              setPendingRenewEvidence(null);
            });
        }}
      />
    </>
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

function CollapsibleDetailSection(props: { children: React.ReactNode; title: string }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between rounded-md px-1 py-2 text-left text-sm font-semibold hover:bg-muted/50"
        >
          {props.title}
          <span className="text-xs text-muted-foreground">{isOpen ? 'Collapse' : 'Expand'}</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-6 pt-2">{props.children}</CollapsibleContent>
    </Collapsible>
  );
}

function FrameworkAccordionItem(props: { title: string; value: string; values: string[] }) {
  return (
    <MappingAccordionItem value={props.value} className="border-b last:border-b-0">
      <MappingAccordionTrigger className="px-4 py-3 text-sm">{props.title}</MappingAccordionTrigger>
      <MappingAccordionContent className="px-4">
        {props.values.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {props.values.map((value) => (
              <li key={value}>{value}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No mappings available.</p>
        )}
      </MappingAccordionContent>
    </MappingAccordionItem>
  );
}
