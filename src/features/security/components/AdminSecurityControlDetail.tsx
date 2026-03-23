import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';
import { Archive, Check, History, MoreHorizontal, RefreshCw } from 'lucide-react';
import { useCallback, useState } from 'react';
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { Input } from '~/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { SheetDescription, SheetHeader, SheetTitle } from '~/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';
import { Textarea } from '~/components/ui/textarea';
import {
  Accordion as MappingAccordion,
  AccordionContent as MappingAccordionContent,
  AccordionItem as MappingAccordionItem,
  AccordionTrigger as MappingAccordionTrigger,
} from '~/components/ui/accordion';
import {
  EVIDENCE_REVIEW_DUE_OPTIONS,
  EVIDENCE_SOURCE_OPTIONS,
  EVIDENCE_SUFFICIENCY_OPTIONS,
} from '~/features/security/constants';
import {
  formatChecklistStatus,
  formatControlResponsibility,
  formatEvidenceActivityEvent,
  formatEvidenceDate,
  formatEvidenceLifecycleStatus,
  formatEvidenceReviewDueInterval,
  formatEvidenceReviewStatus,
  formatEvidenceSource,
  formatEvidenceSufficiency,
  formatEvidenceTimestamp,
  formatHipaaMapping,
  formatReviewRunStatus,
  getChecklistStatusBadgeVariant,
  getEvidenceLifecycleBadgeVariant,
  getEvidenceReviewBadgeVariant,
  getEvidenceSufficiencyBadgeVariant,
  getTodayDateInputValue,
  parseEvidenceDateInput,
} from '~/features/security/formatters';
import type {
  EvidenceReviewDueIntervalMonths,
  EvidenceSource,
  EvidenceSufficiency,
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
        <SheetTitle>
          {control.nist80053Id} {control.title}
        </SheetTitle>
        <SheetDescription>{control.familyTitle}</SheetDescription>
        {control.hasExpiringSoonEvidence ? <Badge variant="secondary">Expiring soon</Badge> : null}
      </SheetHeader>

      <div className="space-y-6 p-4">
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
        </DetailSection>

        <DetailSection title="Description">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {control.implementationSummary}
          </p>
        </DetailSection>

        <DetailSection title="Checklist">
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

        <DetailSection title="Linked operations">
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
                (mapping) => `${mapping.referenceId}${mapping.label ? ` · ${mapping.label}` : ''}`,
              )}
            />
            <FrameworkAccordionItem
              title="SOC 2"
              value="soc2"
              values={control.mappings.soc2.map(
                (mapping) => `${mapping.criterionId}${mapping.label ? ` · ${mapping.label}` : ''}`,
              )}
            />
          </MappingAccordion>
        </DetailSection>
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
        <ChecklistAccordionItem
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

function ChecklistAccordionItem(props: {
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
  const [proofComposerTab, setProofComposerTab] = useState<'link' | 'note' | 'file'>('link');
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkDescription, setLinkDescription] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [noteDescription, setNoteDescription] = useState('');
  const [evidenceDateInput, setEvidenceDateInput] = useState(() => getTodayDateInputValue());
  const [reviewDueIntervalMonths, setReviewDueIntervalMonths] =
    useState<EvidenceReviewDueIntervalMonths>(12);
  const [source, setSource] = useState<EvidenceSource | ''>('');
  const [sufficiency, setSufficiency] = useState<EvidenceSufficiency>('sufficient');
  const linkKey = `${control.internalControlId}:${item.itemId}:link`;
  const noteKey = `${control.internalControlId}:${item.itemId}:note`;
  const activeEvidence = item.evidence.filter((evidence) => evidence.lifecycleStatus === 'active');
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
  const metadataIsComplete = evidenceDateInput.length > 0 && source !== '';

  const resetEvidenceComposer = useCallback(() => {
    setLinkTitle('');
    setLinkUrl('');
    setLinkDescription('');
    setNoteTitle('');
    setNoteDescription('');
    setEvidenceDateInput(getTodayDateInputValue());
    setReviewDueIntervalMonths(12);
    setSource('');
    setSufficiency('sufficient');
    setProofComposerTab('link');
  }, []);

  return (
    <AccordionItem value={item.itemId} className="border-b last:border-b-0">
      <AccordionTrigger className="px-5 py-4 text-left focus-visible:border-transparent focus-visible:ring-1 focus-visible:ring-border/70 data-[state=open]:bg-muted/20">
        <div className="flex flex-1 items-center justify-between gap-4 pr-4">
          <span className="text-sm font-medium">{item.label}</span>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!item.required ? <Badge variant="outline">Optional</Badge> : null}
            {item.hasExpiringSoonEvidence ? <Badge variant="secondary">Expiring soon</Badge> : null}
            <Badge variant={getChecklistStatusBadgeVariant(item.status)}>
              {formatChecklistStatus(item.status)}
            </Badge>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="space-y-4 px-4 pb-4">
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{item.description}</p>
          {item.reviewArtifact ? (
            <div className="rounded-md border bg-muted/20 p-3 text-sm">
              <p className="font-medium">{item.reviewArtifact.reviewTaskTitle}</p>
              <p className="text-muted-foreground">
                {item.reviewArtifact.reviewRunTitle} ·{' '}
                {formatReviewRunStatus(item.reviewArtifact.reviewRunStatus)}
              </p>
              <p className="text-muted-foreground">
                Satisfied {formatEvidenceTimestamp(item.reviewArtifact.satisfiedAt)}
                {item.reviewArtifact.satisfiedByDisplay
                  ? ` · ${item.reviewArtifact.satisfiedByDisplay}`
                  : ''}
              </p>
              {item.reviewArtifact.relatedReports.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {item.reviewArtifact.relatedReports.map((report) => (
                    <Badge key={report.id} variant="outline">
                      {report.reportKind} · {report.label}
                    </Badge>
                  ))}
                </div>
              ) : null}
              <div className="mt-3">
                <Button type="button" variant="outline" size="sm" onClick={props.onOpenReviews}>
                  Open reviews
                </Button>
              </div>
            </div>
          ) : null}
          <p className="text-sm font-medium">Evidence</p>
        </div>

        {activeEvidence.length ? (
          <div className="space-y-3">
            {activeEvidence.map((evidence) => (
              <div key={evidence.id} className="space-y-3 rounded-md border px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 flex-1 text-sm font-medium">{evidence.title}</p>
                  <div className="flex items-center gap-2">
                    {evidence.expiryStatus === 'expiring_soon' ? (
                      <Badge variant="secondary">Expiring soon</Badge>
                    ) : null}
                    <Badge variant={getEvidenceSufficiencyBadgeVariant(evidence.sufficiency)}>
                      {formatEvidenceSufficiency(evidence.sufficiency)}
                    </Badge>
                    <Badge variant={getEvidenceReviewBadgeVariant(evidence.reviewStatus)}>
                      {formatEvidenceReviewStatus(evidence.reviewStatus)}
                    </Badge>
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
                        <DropdownMenuItem onSelect={() => setPendingArchiveEvidence(evidence)}>
                          <Archive className="size-4" />
                          Archive
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setPendingRenewEvidence(evidence)}>
                          <RefreshCw className="size-4" />
                          Renew
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    {evidence.description ?? 'No additional description provided.'}
                  </p>
                  {evidence.url ? (
                    <p className="truncate text-xs text-muted-foreground">{evidence.url}</p>
                  ) : null}
                  <div className="space-y-1 text-xs text-muted-foreground">
                    {evidence.source ? (
                      <p>
                        <span className="font-medium text-foreground">Source:</span>{' '}
                        {formatEvidenceSource(evidence.source)}
                      </p>
                    ) : null}
                    {evidence.evidenceDate ? (
                      <p>
                        <span className="font-medium text-foreground">Evidence date:</span>{' '}
                        {formatEvidenceDate(evidence.evidenceDate)}
                      </p>
                    ) : null}
                    {evidence.reviewDueAt ? (
                      <p>
                        <span className="font-medium text-foreground">Review due:</span>{' '}
                        {formatEvidenceDate(evidence.reviewDueAt)}
                      </p>
                    ) : null}
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
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {evidence.evidenceType !== 'note' ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void props.onOpenEvidence(evidence)}
                    >
                      Open
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
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
          </div>
        ) : (
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
        )}
      </AccordionContent>

      <Dialog
        open={isAddingProof}
        onOpenChange={(open) => {
          setIsAddingProof(open);
          if (!open) {
            resetEvidenceComposer();
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add evidence</DialogTitle>
            <DialogDescription>
              {item.label}. Suggested evidence: {item.suggestedEvidenceTypes.join(', ')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor={`${item.itemId}-evidence-date`}>
                  Evidence date
                </label>
                <Input
                  id={`${item.itemId}-evidence-date`}
                  type="date"
                  value={evidenceDateInput}
                  onChange={(event) => setEvidenceDateInput(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor={`${item.itemId}-review-due`}>
                  Review due
                </label>
                <Select
                  value={String(reviewDueIntervalMonths)}
                  onValueChange={(value) =>
                    setReviewDueIntervalMonths(Number(value) as EvidenceReviewDueIntervalMonths)
                  }
                >
                  <SelectTrigger id={`${item.itemId}-review-due`} className="w-full">
                    <SelectValue placeholder="Select interval" />
                  </SelectTrigger>
                  <SelectContent>
                    {EVIDENCE_REVIEW_DUE_OPTIONS.map((option) => (
                      <SelectItem key={option} value={String(option)}>
                        {formatEvidenceReviewDueInterval(option)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor={`${item.itemId}-source`}>
                  Source
                </label>
                <Select
                  value={source}
                  onValueChange={(value) => setSource(value as EvidenceSource)}
                >
                  <SelectTrigger id={`${item.itemId}-source`} className="w-full">
                    <SelectValue placeholder="Select source" />
                  </SelectTrigger>
                  <SelectContent>
                    {EVIDENCE_SOURCE_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {formatEvidenceSource(option)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor={`${item.itemId}-sufficiency`}>
                  Sufficiency
                </label>
                <Select
                  value={sufficiency}
                  onValueChange={(value) => setSufficiency(value as EvidenceSufficiency)}
                >
                  <SelectTrigger id={`${item.itemId}-sufficiency`} className="w-full">
                    <SelectValue placeholder="Select sufficiency" />
                  </SelectTrigger>
                  <SelectContent>
                    {EVIDENCE_SUFFICIENCY_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {formatEvidenceSufficiency(option)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Tabs
              value={proofComposerTab}
              onValueChange={(value) => setProofComposerTab(value as 'link' | 'note' | 'file')}
              className="space-y-3"
            >
              <TabsList className="w-full justify-start overflow-auto">
                <TabsTrigger value="link">Link</TabsTrigger>
                <TabsTrigger value="note">Note</TabsTrigger>
                <TabsTrigger value="file">File</TabsTrigger>
              </TabsList>

              <TabsContent value="link" className="space-y-2">
                <Input
                  value={linkTitle}
                  onChange={(event) => setLinkTitle(event.target.value)}
                  placeholder="Link title"
                />
                <Input
                  value={linkUrl}
                  onChange={(event) => setLinkUrl(event.target.value)}
                  placeholder="https://…"
                />
                <Textarea
                  value={linkDescription}
                  onChange={(event) => setLinkDescription(event.target.value)}
                  placeholder="What this evidence shows"
                />
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsAddingProof(false)}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    disabled={
                      props.busyAction === linkKey ||
                      !metadataIsComplete ||
                      linkTitle.trim().length === 0 ||
                      linkUrl.trim().length === 0
                    }
                    onClick={() => {
                      const evidenceDate = parseEvidenceDateInput(evidenceDateInput);
                      if (evidenceDate === null || source === '') {
                        return;
                      }
                      void props
                        .onAddEvidenceLink({
                          description: linkDescription.trim() || undefined,
                          evidenceDate,
                          internalControlId: control.internalControlId,
                          itemId: item.itemId,
                          reviewDueIntervalMonths,
                          source,
                          sufficiency,
                          title: linkTitle.trim(),
                          url: linkUrl.trim(),
                        })
                        .then(() => {
                          setIsAddingProof(false);
                          resetEvidenceComposer();
                        });
                    }}
                  >
                    {props.busyAction === linkKey ? 'Saving…' : 'Attach link'}
                  </Button>
                </DialogFooter>
              </TabsContent>

              <TabsContent value="note" className="space-y-2">
                <Input
                  value={noteTitle}
                  onChange={(event) => setNoteTitle(event.target.value)}
                  placeholder="Note title"
                />
                <Textarea
                  value={noteDescription}
                  onChange={(event) => setNoteDescription(event.target.value)}
                  placeholder="Paste reviewer note or summary"
                />
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsAddingProof(false)}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    disabled={
                      props.busyAction === noteKey ||
                      !metadataIsComplete ||
                      noteTitle.trim().length === 0 ||
                      noteDescription.trim().length === 0
                    }
                    onClick={() => {
                      const evidenceDate = parseEvidenceDateInput(evidenceDateInput);
                      if (evidenceDate === null || source === '') {
                        return;
                      }
                      void props
                        .onAddEvidenceNote({
                          description: noteDescription.trim(),
                          evidenceDate,
                          internalControlId: control.internalControlId,
                          itemId: item.itemId,
                          reviewDueIntervalMonths,
                          source,
                          sufficiency,
                          title: noteTitle.trim(),
                        })
                        .then(() => {
                          setIsAddingProof(false);
                          resetEvidenceComposer();
                        });
                    }}
                  >
                    {props.busyAction === noteKey ? 'Saving…' : 'Attach note'}
                  </Button>
                </DialogFooter>
              </TabsContent>

              <TabsContent value="file" className="space-y-2">
                <Input
                  type="file"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    const evidenceDate = parseEvidenceDateInput(evidenceDateInput);
                    if (!file || evidenceDate === null || source === '') {
                      event.target.value = '';
                      return;
                    }
                    void props
                      .onUploadEvidenceFile({
                        description: undefined,
                        evidenceDate,
                        file,
                        internalControlId: control.internalControlId,
                        itemId: item.itemId,
                        reviewDueIntervalMonths,
                        source,
                        sufficiency,
                        title: file.name,
                      })
                      .finally(() => {
                        event.target.value = '';
                      });
                  }}
                />
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsAddingProof(false)}>
                    Close
                  </Button>
                </DialogFooter>
              </TabsContent>
            </Tabs>
          </div>
        </DialogContent>
      </Dialog>

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
                <p className="text-sm text-muted-foreground">Loading activity…</p>
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
    </AccordionItem>
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
