import type { Id } from '@convex/_generated/dataModel';
import { useEffect, useId, useMemo, useState } from 'react';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import { Input } from '~/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';
import { Textarea } from '~/components/ui/textarea';
import {
  EVIDENCE_REVIEW_DUE_OPTIONS,
  EVIDENCE_SOURCE_OPTIONS,
  EVIDENCE_SUFFICIENCY_OPTIONS,
} from '~/features/security/constants';
import {
  formatEvidenceReviewDueInterval,
  formatEvidenceSource,
  formatEvidenceSufficiency,
  formatFindingSeverity,
  formatFindingStatus,
  getFindingSeverityBadgeVariant,
  getTodayDateInputValue,
  parseEvidenceDateInput,
} from '~/features/security/formatters';
import type {
  EvidenceReviewDueIntervalMonths,
  EvidenceSource,
  EvidenceSufficiency,
  SecurityFindingFollowUpAction,
  SecurityFindingListItem,
} from '~/features/security/types';

function formatFindingDisposition(disposition: SecurityFindingListItem['disposition']) {
  switch (disposition) {
    case 'accepted_risk':
      return 'Accepted risk';
    case 'false_positive':
      return 'False positive';
    case 'investigating':
      return 'Investigating';
    case 'pending_review':
      return 'Pending review';
    case 'resolved':
      return 'Resolved';
  }
}

function formatFollowUpStatus(status: SecurityFindingFollowUpAction['status']) {
  switch (status) {
    case 'open':
      return 'Open';
    case 'in_progress':
      return 'In progress';
    case 'blocked':
      return 'Blocked';
    case 'resolved':
      return 'Resolved';
  }
}

function getFollowUpStatusBadgeVariant(
  status: SecurityFindingFollowUpAction['status'],
): 'default' | 'destructive' | 'outline' | 'secondary' {
  switch (status) {
    case 'resolved':
      return 'default';
    case 'blocked':
      return 'destructive';
    case 'in_progress':
      return 'secondary';
    case 'open':
      return 'outline';
  }
}

function toDateInputValue(timestamp: number | null) {
  if (timestamp === null) {
    return '';
  }
  return new Date(timestamp).toISOString().slice(0, 10);
}

function formatControlLinkLabel(
  controlLink: SecurityFindingFollowUpAction['controlLinks'][number],
) {
  return `${controlLink.nist80053Id} · ${controlLink.title}${controlLink.itemLabel ? ` · ${controlLink.itemLabel}` : ''}`;
}

type FollowUpControlLink = {
  internalControlId: string;
  itemId: string;
};

export function AdminSecurityFindingDetail(props: {
  busyAction: string | null;
  finding: SecurityFindingListItem;
  onAddFollowUpEvidenceLink: (args: {
    description?: string;
    evidenceDate: number;
    followUpActionId: Id<'followUpActions'>;
    internalControlId: string;
    itemId: string;
    reviewDueIntervalMonths: EvidenceReviewDueIntervalMonths;
    source: EvidenceSource;
    sufficiency: EvidenceSufficiency;
    title: string;
    url: string;
  }) => Promise<void>;
  onAddFollowUpEvidenceNote: (args: {
    description: string;
    evidenceDate: number;
    followUpActionId: Id<'followUpActions'>;
    internalControlId: string;
    itemId: string;
    reviewDueIntervalMonths: EvidenceReviewDueIntervalMonths;
    source: EvidenceSource;
    sufficiency: EvidenceSufficiency;
    title: string;
  }) => Promise<void>;
  onAssignFollowUpToCurrentUser: (followUpActionId: Id<'followUpActions'>) => void;
  onClearFollowUpAssignee: (followUpActionId: Id<'followUpActions'>) => void;
  onCreateFollowUpAction: (args: {
    controlLinks: FollowUpControlLink[];
    dueAt?: number | null;
    findingKey: string;
    summary?: string | null;
  }) => Promise<void>;
  onOpenControl: (internalControlId: string) => void;
  onOpenReviews: (selectedReviewRun?: string) => void;
  onResolveFollowUpAction: (args: {
    followUpActionId: Id<'followUpActions'>;
    resolutionNote?: string | null;
  }) => Promise<void>;
  onUpdateFollowUpAction: (args: {
    assigneeUserId?: string | null;
    dueAt?: number | null;
    followUpActionId: Id<'followUpActions'>;
    latestNote?: string | null;
    status?: 'blocked' | 'in_progress' | 'open';
    summary?: string | null;
  }) => Promise<void>;
  onUploadFollowUpEvidenceFile: (args: {
    description?: string;
    evidenceDate: number;
    file: File;
    followUpActionId: Id<'followUpActions'>;
    internalControlId: string;
    itemId: string;
    reviewDueIntervalMonths: EvidenceReviewDueIntervalMonths;
    source: EvidenceSource;
    sufficiency: EvidenceSufficiency;
    title: string;
  }) => Promise<void>;
}) {
  const fieldId = useId();
  const activeFollowUp = props.finding.activeFollowUp;
  const selectableControlLinks = useMemo(
    () =>
      props.finding.relatedControls.filter(
        (control): control is typeof control & { itemId: string } => control.itemId !== null,
      ),
    [props.finding.relatedControls],
  );
  const [selectedControlKeys, setSelectedControlKeys] = useState<string[]>(
    selectableControlLinks.map((control) => `${control.internalControlId}:${control.itemId}`),
  );
  const [createSummary, setCreateSummary] = useState('');
  const [createDueDateInput, setCreateDueDateInput] = useState('');
  const [followUpSummary, setFollowUpSummary] = useState(activeFollowUp?.summary ?? '');
  const [followUpLatestNote, setFollowUpLatestNote] = useState(activeFollowUp?.latestNote ?? '');
  const [followUpStatus, setFollowUpStatus] = useState<'blocked' | 'in_progress' | 'open'>(
    activeFollowUp?.status === 'blocked'
      ? 'blocked'
      : activeFollowUp?.status === 'in_progress'
        ? 'in_progress'
        : 'open',
  );
  const [followUpDueDateInput, setFollowUpDueDateInput] = useState(
    toDateInputValue(activeFollowUp?.dueAt ?? null),
  );
  const [resolutionNote, setResolutionNote] = useState(activeFollowUp?.resolutionNote ?? '');
  const [evidenceTab, setEvidenceTab] = useState<'link' | 'note' | 'file'>('link');
  const [evidenceControlKey, setEvidenceControlKey] = useState(
    activeFollowUp?.controlLinks[0]
      ? `${activeFollowUp.controlLinks[0].internalControlId}:${activeFollowUp.controlLinks[0].itemId}`
      : '',
  );
  const [evidenceDateInput, setEvidenceDateInput] = useState(getTodayDateInputValue());
  const [reviewDueIntervalMonths, setReviewDueIntervalMonths] =
    useState<EvidenceReviewDueIntervalMonths>(12);
  const [source, setSource] = useState<EvidenceSource>('internal_review');
  const [sufficiency, setSufficiency] = useState<EvidenceSufficiency>('sufficient');
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkDescription, setLinkDescription] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [noteDescription, setNoteDescription] = useState('');
  const [fileTitle, setFileTitle] = useState('');
  const [fileDescription, setFileDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    setSelectedControlKeys(
      selectableControlLinks.map((control) => `${control.internalControlId}:${control.itemId}`),
    );
    setCreateSummary('');
    setCreateDueDateInput('');
  }, [props.finding.findingKey, selectableControlLinks]);

  useEffect(() => {
    setFollowUpSummary(activeFollowUp?.summary ?? '');
    setFollowUpLatestNote(activeFollowUp?.latestNote ?? '');
    setFollowUpStatus(
      activeFollowUp?.status === 'blocked'
        ? 'blocked'
        : activeFollowUp?.status === 'in_progress'
          ? 'in_progress'
          : 'open',
    );
    setFollowUpDueDateInput(toDateInputValue(activeFollowUp?.dueAt ?? null));
    setResolutionNote(activeFollowUp?.resolutionNote ?? '');
    setEvidenceControlKey(
      activeFollowUp?.controlLinks[0]
        ? `${activeFollowUp.controlLinks[0].internalControlId}:${activeFollowUp.controlLinks[0].itemId}`
        : '',
    );
  }, [
    activeFollowUp?.dueAt,
    activeFollowUp?.id,
    activeFollowUp?.latestNote,
    activeFollowUp?.resolutionNote,
    activeFollowUp?.status,
    activeFollowUp?.summary,
    activeFollowUp?.controlLinks,
  ]);

  const selectedCreateControlLinks = selectedControlKeys
    .map((key) => {
      const [internalControlId, itemId] = key.split(':');
      return internalControlId && itemId ? { internalControlId, itemId } : null;
    })
    .filter((entry): entry is FollowUpControlLink => entry !== null);
  const selectedEvidenceControlLink = activeFollowUp?.controlLinks.find(
    (controlLink) =>
      `${controlLink.internalControlId}:${controlLink.itemId}` === evidenceControlKey,
  );

  const metadataIsComplete = evidenceDateInput.trim().length > 0;

  return (
    <div className="space-y-6 p-1">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-2xl font-semibold">{props.finding.title}</h2>
          <Badge variant={getFindingSeverityBadgeVariant(props.finding.severity)}>
            {formatFindingSeverity(props.finding.severity)}
          </Badge>
          <Badge variant={props.finding.status === 'open' ? 'destructive' : 'secondary'}>
            {formatFindingStatus(props.finding.status)}
          </Badge>
          {activeFollowUp ? (
            <Badge variant={getFollowUpStatusBadgeVariant(activeFollowUp.status)}>
              Follow-up {formatFollowUpStatus(activeFollowUp.status)}
            </Badge>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">{props.finding.description}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3 rounded-lg border p-4">
          <p className="text-sm font-medium text-muted-foreground">Finding state</p>
          <p>{formatFindingDisposition(props.finding.disposition)}</p>
          <p className="text-sm text-muted-foreground">Source: {props.finding.sourceLabel}</p>
          <p className="text-sm text-muted-foreground">
            First observed {new Date(props.finding.firstObservedAt).toLocaleString()}
          </p>
          <p className="text-sm text-muted-foreground">
            Last observed {new Date(props.finding.lastObservedAt).toLocaleString()}
          </p>
          {props.finding.reviewedAt ? (
            <p className="text-sm text-muted-foreground">
              Reviewed {new Date(props.finding.reviewedAt).toLocaleString()}
              {props.finding.reviewedByDisplay ? ` by ${props.finding.reviewedByDisplay}` : ''}
            </p>
          ) : null}
        </div>
        <div className="space-y-3 rounded-lg border p-4">
          <p className="text-sm font-medium text-muted-foreground">Review notes</p>
          <p className="text-sm">{props.finding.internalNotes ?? 'No internal notes recorded.'}</p>
          <p className="text-sm font-medium text-muted-foreground">Customer summary</p>
          <p className="text-sm">
            {props.finding.customerSummary ?? 'No customer summary recorded.'}
          </p>
          <p className="text-sm font-medium text-muted-foreground">Linked review run</p>
          <p className="text-sm">
            {props.finding.latestLinkedReviewRun
              ? `${props.finding.latestLinkedReviewRun.title} (${props.finding.latestLinkedReviewRun.status})`
              : 'No linked follow-up review run.'}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">Linked controls</p>
        {props.finding.relatedControls.length ? (
          <div className="flex flex-wrap gap-2">
            {props.finding.relatedControls.map((control) => (
              <Button
                key={`${props.finding.findingKey}:${control.internalControlId}:${control.itemId ?? 'none'}`}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  props.onOpenControl(control.internalControlId);
                }}
              >
                {control.nist80053Id} · {control.title}
              </Button>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            No linked controls.
          </div>
        )}
      </div>

      {activeFollowUp ? (
        <div className="space-y-4 rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Tracked follow-up</p>
              <p className="text-sm text-muted-foreground">
                {activeFollowUp.reviewedEvidenceCount} reviewed evidence item
                {activeFollowUp.reviewedEvidenceCount === 1 ? '' : 's'} linked for closure
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  props.onAssignFollowUpToCurrentUser(activeFollowUp.id);
                }}
                disabled={props.busyAction !== null}
              >
                Assign to me
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  props.onClearFollowUpAssignee(activeFollowUp.id);
                }}
                disabled={props.busyAction !== null}
              >
                Clear assignee
              </Button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor={`${fieldId}-fu-summary`}>
                Summary
              </label>
              <Textarea
                id={`${fieldId}-fu-summary`}
                value={followUpSummary}
                onChange={(event) => setFollowUpSummary(event.target.value)}
                placeholder="What remediation work is being tracked"
                className="min-h-24"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor={`${fieldId}-fu-latest-note`}>
                Latest work note
              </label>
              <Textarea
                id={`${fieldId}-fu-latest-note`}
                value={followUpLatestNote}
                onChange={(event) => setFollowUpLatestNote(event.target.value)}
                placeholder="Latest operator update"
                className="min-h-24"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor={`${fieldId}-fu-status`}>
                Status
              </label>
              <Select
                value={followUpStatus}
                onValueChange={(value: 'blocked' | 'in_progress' | 'open') => {
                  setFollowUpStatus(value);
                }}
              >
                <SelectTrigger id={`${fieldId}-fu-status`}>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="in_progress">In progress</SelectItem>
                  <SelectItem value="blocked">Blocked</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor={`${fieldId}-fu-due`}>
                Due date
              </label>
              <Input
                id={`${fieldId}-fu-due`}
                type="date"
                value={followUpDueDateInput}
                onChange={(event) => setFollowUpDueDateInput(event.target.value)}
              />
            </div>
            <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
              <p className="font-medium text-muted-foreground">Assignment</p>
              <p>{activeFollowUp.assigneeDisplay ?? 'Unassigned'}</p>
              <p className="mt-2 text-muted-foreground">
                Updated {new Date(activeFollowUp.updatedAt).toLocaleString()}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={props.busyAction !== null}
              onClick={() => {
                void props.onUpdateFollowUpAction({
                  dueAt:
                    followUpDueDateInput.trim().length > 0
                      ? parseEvidenceDateInput(followUpDueDateInput)
                      : null,
                  followUpActionId: activeFollowUp.id,
                  latestNote: followUpLatestNote,
                  status: followUpStatus,
                  summary: followUpSummary,
                });
              }}
            >
              {props.busyAction === `follow-up:update:${activeFollowUp.id}`
                ? 'Saving…'
                : 'Save follow-up'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={props.busyAction !== null || activeFollowUp.reviewedEvidenceCount === 0}
              onClick={() => {
                void props.onResolveFollowUpAction({
                  followUpActionId: activeFollowUp.id,
                  resolutionNote,
                });
              }}
            >
              {props.busyAction === `follow-up:resolve:${activeFollowUp.id}`
                ? 'Resolving…'
                : 'Resolve follow-up'}
            </Button>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor={`${fieldId}-fu-resolution`}>
              Resolution note
            </label>
            <Textarea
              id={`${fieldId}-fu-resolution`}
              value={resolutionNote}
              onChange={(event) => setResolutionNote(event.target.value)}
              placeholder="What closed the remediation item"
              className="min-h-24"
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Tracked checklist items</p>
            <div className="flex flex-wrap gap-2">
              {activeFollowUp.controlLinks.map((controlLink) => (
                <Button
                  key={`${activeFollowUp.id}:${controlLink.internalControlId}:${controlLink.itemId}`}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    props.onOpenControl(controlLink.internalControlId);
                  }}
                >
                  {formatControlLinkLabel(controlLink)}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium">Closure evidence</p>
            {activeFollowUp.reviewedEvidence.length ? (
              <div className="space-y-2">
                {activeFollowUp.reviewedEvidence.map((evidence) => (
                  <div
                    key={evidence.id}
                    className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground"
                  >
                    <p className="font-medium text-foreground">{evidence.title}</p>
                    <p>
                      {evidence.internalControlId} · {evidence.itemId}
                    </p>
                    <p>
                      Reviewed{' '}
                      {evidence.reviewedAt
                        ? new Date(evidence.reviewedAt).toLocaleString()
                        : 'pending timestamp'}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                No reviewed closure evidence is linked yet. Add proof below, then review it from the
                controls workspace before resolving this follow-up.
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-4">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor={`${fieldId}-fu-ev-checklist`}>
                  Checklist item
                </label>
                <Select value={evidenceControlKey} onValueChange={setEvidenceControlKey}>
                  <SelectTrigger id={`${fieldId}-fu-ev-checklist`}>
                    <SelectValue placeholder="Select checklist item" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeFollowUp.controlLinks.map((controlLink) => (
                      <SelectItem
                        key={`${controlLink.internalControlId}:${controlLink.itemId}`}
                        value={`${controlLink.internalControlId}:${controlLink.itemId}`}
                      >
                        {formatControlLinkLabel(controlLink)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor={`${fieldId}-fu-ev-date`}>
                  Evidence date
                </label>
                <Input
                  id={`${fieldId}-fu-ev-date`}
                  type="date"
                  value={evidenceDateInput}
                  onChange={(event) => setEvidenceDateInput(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor={`${fieldId}-fu-review-due`}>
                  Review due
                </label>
                <Select
                  value={String(reviewDueIntervalMonths)}
                  onValueChange={(value) =>
                    setReviewDueIntervalMonths(Number(value) as EvidenceReviewDueIntervalMonths)
                  }
                >
                  <SelectTrigger id={`${fieldId}-fu-review-due`}>
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
                <label className="text-sm font-medium" htmlFor={`${fieldId}-fu-source`}>
                  Source
                </label>
                <Select
                  value={source}
                  onValueChange={(value) => setSource(value as EvidenceSource)}
                >
                  <SelectTrigger id={`${fieldId}-fu-source`}>
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
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor={`${fieldId}-fu-sufficiency`}>
                Sufficiency
              </label>
              <Select
                value={sufficiency}
                onValueChange={(value) => setSufficiency(value as EvidenceSufficiency)}
              >
                <SelectTrigger id={`${fieldId}-fu-sufficiency`} className="max-w-xs">
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

            <Tabs
              value={evidenceTab}
              onValueChange={(value) => setEvidenceTab(value as 'link' | 'note' | 'file')}
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
                  placeholder="Evidence title"
                />
                <Input
                  value={linkUrl}
                  onChange={(event) => setLinkUrl(event.target.value)}
                  placeholder="https://…"
                />
                <Textarea
                  value={linkDescription}
                  onChange={(event) => setLinkDescription(event.target.value)}
                  placeholder="What this closure evidence proves"
                />
                <Button
                  type="button"
                  disabled={
                    props.busyAction !== null ||
                    !metadataIsComplete ||
                    !selectedEvidenceControlLink ||
                    linkTitle.trim().length === 0 ||
                    linkUrl.trim().length === 0
                  }
                  onClick={() => {
                    if (!activeFollowUp || !selectedEvidenceControlLink) {
                      return;
                    }
                    const evidenceDate = parseEvidenceDateInput(evidenceDateInput);
                    if (evidenceDate === null) {
                      return;
                    }
                    void props.onAddFollowUpEvidenceLink({
                      description: linkDescription.trim() || undefined,
                      evidenceDate,
                      followUpActionId: activeFollowUp.id,
                      internalControlId: selectedEvidenceControlLink.internalControlId,
                      itemId: selectedEvidenceControlLink.itemId,
                      reviewDueIntervalMonths,
                      source,
                      sufficiency,
                      title: linkTitle.trim(),
                      url: linkUrl.trim(),
                    });
                  }}
                >
                  {props.busyAction === `follow-up:evidence-link:${activeFollowUp.id}`
                    ? 'Saving…'
                    : 'Attach link evidence'}
                </Button>
              </TabsContent>

              <TabsContent value="note" className="space-y-2">
                <Input
                  value={noteTitle}
                  onChange={(event) => setNoteTitle(event.target.value)}
                  placeholder="Evidence title"
                />
                <Textarea
                  value={noteDescription}
                  onChange={(event) => setNoteDescription(event.target.value)}
                  placeholder="Describe the closure evidence"
                />
                <Button
                  type="button"
                  disabled={
                    props.busyAction !== null ||
                    !metadataIsComplete ||
                    !selectedEvidenceControlLink ||
                    noteTitle.trim().length === 0 ||
                    noteDescription.trim().length === 0
                  }
                  onClick={() => {
                    if (!activeFollowUp || !selectedEvidenceControlLink) {
                      return;
                    }
                    const evidenceDate = parseEvidenceDateInput(evidenceDateInput);
                    if (evidenceDate === null) {
                      return;
                    }
                    void props.onAddFollowUpEvidenceNote({
                      description: noteDescription.trim(),
                      evidenceDate,
                      followUpActionId: activeFollowUp.id,
                      internalControlId: selectedEvidenceControlLink.internalControlId,
                      itemId: selectedEvidenceControlLink.itemId,
                      reviewDueIntervalMonths,
                      source,
                      sufficiency,
                      title: noteTitle.trim(),
                    });
                  }}
                >
                  {props.busyAction === `follow-up:evidence-note:${activeFollowUp.id}`
                    ? 'Saving…'
                    : 'Attach note evidence'}
                </Button>
              </TabsContent>

              <TabsContent value="file" className="space-y-2">
                <Input
                  value={fileTitle}
                  onChange={(event) => setFileTitle(event.target.value)}
                  placeholder="Evidence title"
                />
                <Textarea
                  value={fileDescription}
                  onChange={(event) => setFileDescription(event.target.value)}
                  placeholder="Optional file description"
                />
                <Input
                  type="file"
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                  }}
                />
                <Button
                  type="button"
                  disabled={
                    props.busyAction !== null ||
                    !metadataIsComplete ||
                    !selectedEvidenceControlLink ||
                    fileTitle.trim().length === 0 ||
                    file === null
                  }
                  onClick={() => {
                    if (!activeFollowUp || !selectedEvidenceControlLink || !file) {
                      return;
                    }
                    const evidenceDate = parseEvidenceDateInput(evidenceDateInput);
                    if (evidenceDate === null) {
                      return;
                    }
                    void props.onUploadFollowUpEvidenceFile({
                      description: fileDescription.trim() || undefined,
                      evidenceDate,
                      file,
                      followUpActionId: activeFollowUp.id,
                      internalControlId: selectedEvidenceControlLink.internalControlId,
                      itemId: selectedEvidenceControlLink.itemId,
                      reviewDueIntervalMonths,
                      source,
                      sufficiency,
                      title: fileTitle.trim(),
                    });
                  }}
                >
                  {props.busyAction === `follow-up:evidence-file:${activeFollowUp.id}`
                    ? 'Uploading…'
                    : 'Upload file evidence'}
                </Button>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      ) : (
        <div className="space-y-4 rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">Start tracked follow-up</p>
            <p className="text-sm text-muted-foreground">
              Select the checklist items this remediation work should support, then set the scope
              and due date.
            </p>
          </div>
          <div className="space-y-2">
            {selectableControlLinks.map((control) => {
              const controlKey = `${control.internalControlId}:${control.itemId}`;
              const checked = selectedControlKeys.includes(controlKey);
              return (
                <label
                  key={controlKey}
                  className="flex items-start gap-3 rounded-md border p-3 text-sm"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(nextChecked) => {
                      setSelectedControlKeys((current) => {
                        if (nextChecked) {
                          return Array.from(new Set([...current, controlKey]));
                        }
                        return current.filter((entry) => entry !== controlKey);
                      });
                    }}
                  />
                  <span>
                    <span className="font-medium">
                      {control.nist80053Id} · {control.title}
                    </span>
                    {control.itemLabel ? (
                      <span className="block text-muted-foreground">{control.itemLabel}</span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor={`${fieldId}-cr-summary`}>
                Summary
              </label>
              <Textarea
                id={`${fieldId}-cr-summary`}
                value={createSummary}
                onChange={(event) => setCreateSummary(event.target.value)}
                placeholder="Describe the remediation work that will be tracked"
                className="min-h-24"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor={`${fieldId}-cr-due`}>
                Due date
              </label>
              <Input
                id={`${fieldId}-cr-due`}
                type="date"
                value={createDueDateInput}
                onChange={(event) => setCreateDueDateInput(event.target.value)}
              />
            </div>
          </div>
          <Button
            type="button"
            disabled={props.busyAction !== null || selectedCreateControlLinks.length === 0}
            onClick={() => {
              void props.onCreateFollowUpAction({
                controlLinks: selectedCreateControlLinks,
                dueAt:
                  createDueDateInput.trim().length > 0
                    ? parseEvidenceDateInput(createDueDateInput)
                    : null,
                findingKey: props.finding.findingKey,
                summary: createSummary,
              });
            }}
          >
            {props.busyAction === `follow-up:create:${props.finding.findingKey}`
              ? 'Starting…'
              : 'Start tracked follow-up'}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            props.onOpenReviews(props.finding.latestLinkedReviewRun?.id);
          }}
        >
          {props.finding.latestLinkedReviewRun ? 'Open linked review run' : 'Open reviews'}
        </Button>
        {props.finding.latestLinkedReviewRun ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              props.onOpenReviews();
            }}
          >
            Open all reviews
          </Button>
        ) : null}
      </div>
    </div>
  );
}
