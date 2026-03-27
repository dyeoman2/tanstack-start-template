import { useState } from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '~/components/ui/accordion';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { Textarea } from '~/components/ui/textarea';
import {
  formatReviewTaskEvidenceSourceType,
  getReviewTaskBadgeVariant,
  getReviewTaskStatusLabel,
} from '~/features/security/formatters';
import type { ReviewTaskDetail } from '~/features/security/types';

export function AdminSecurityReviewTaskGroup(props: {
  busyAction: string | null;
  description: string;
  documents: Record<string, { label: string; url: string; version: string }>;
  notes: Record<string, string>;
  onAttestTask: (task: ReviewTaskDetail) => Promise<void>;
  onBatchReview?: () => void;
  onChangeDocumentField: (
    taskId: string,
    field: 'label' | 'url' | 'version',
    value: string,
  ) => void;
  onChangeNote: (taskId: string, value: string) => void;
  onExceptionTask: (task: ReviewTaskDetail) => Promise<void>;
  onOpenControl: (internalControlId: string) => void;
  onOpenFollowUp: (task: ReviewTaskDetail) => Promise<void>;
  tasks: ReviewTaskDetail[];
  title: string;
  defaultCollapsed?: boolean;
}) {
  if (props.defaultCollapsed) {
    return <CollapsedReviewTaskGroup {...props} />;
  }

  const doneCount = props.tasks.filter(
    (t) => t.status === 'completed' || t.status === 'exception',
  ).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{props.title}</CardTitle>
          <Badge variant="outline">{props.tasks.length}</Badge>
          <Badge variant="outline">
            {doneCount} of {props.tasks.length} done
          </Badge>
          {props.onBatchReview && props.tasks.length > 1 ? (
            <Button type="button" variant="outline" size="sm" onClick={props.onBatchReview}>
              Review all
            </Button>
          ) : null}
        </div>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {props.tasks.length ? (
          <Accordion type="multiple" className="rounded-md border">
            {props.tasks.map((task) => {
              const document = props.documents[task.id] ?? {
                label: '',
                url: '',
                version: '',
              };
              return (
                <AccordionItem key={task.id} value={task.id} className="border-b last:border-b-0">
                  <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{task.title}</p>
                        <Badge variant={getReviewTaskBadgeVariant(task)}>
                          {getReviewTaskStatusLabel(task)}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {task.taskType === 'automated_check'
                            ? 'Auto'
                            : task.taskType === 'document_upload'
                              ? 'Document'
                              : task.taskType === 'follow_up'
                                ? 'Follow-up'
                                : 'Attestation'}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{task.description}</p>
                      {task.latestAttestation ? (
                        <p className="text-sm text-muted-foreground">
                          Attested {new Date(task.latestAttestation.attestedAt).toLocaleString()}
                          {task.latestAttestation.attestedByDisplay
                            ? ` · ${task.latestAttestation.attestedByDisplay}`
                            : ''}
                        </p>
                      ) : null}
                      {task.latestNote ? (
                        <p className="text-sm text-muted-foreground">
                          Latest note: {task.latestNote}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-3">
                      {task.taskType !== 'follow_up' &&
                      task.taskType !== 'automated_check' &&
                      task.status !== 'completed' &&
                      task.status !== 'exception' ? (
                        <Button
                          type="button"
                          size="sm"
                          disabled={props.busyAction !== null}
                          onClick={() => {
                            void props.onAttestTask(task);
                          }}
                        >
                          {props.busyAction === `${task.id}:attest`
                            ? 'Saving…'
                            : task.taskType === 'document_upload'
                              ? 'Upload'
                              : 'Attest'}
                        </Button>
                      ) : null}
                      {task.evidenceLinks.length ? (
                        <p className="text-sm text-muted-foreground">
                          {task.evidenceLinks.length} evidence
                        </p>
                      ) : null}
                      <AccordionTrigger className="py-0 text-sm">Details</AccordionTrigger>
                    </div>
                  </div>
                  <AccordionContent className="space-y-4 px-4 pb-4">
                    {task.taskType === 'automated_check' ? (
                      <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
                        {task.status === 'completed'
                          ? 'This task is already satisfied by auto-collected evidence. Review the linked evidence or open follow-up only if something changed.'
                          : 'This task depends on automated evidence collection. Refresh evidence or open follow-up if the result looks incorrect.'}
                      </div>
                    ) : null}

                    {task.evidenceLinks.length ? (
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Linked evidence</p>
                        <div className="space-y-2">
                          {task.evidenceLinks.map((link) => (
                            <div key={link.id} className="rounded-md border p-3 text-sm">
                              <p className="font-medium">{link.sourceLabel}</p>
                              <p className="text-muted-foreground">
                                {formatReviewTaskEvidenceSourceType(link.sourceType)} · Linked{' '}
                                {new Date(link.linkedAt).toLocaleString()}
                                {link.freshAt
                                  ? ` · Fresh ${new Date(link.freshAt).toLocaleString()}`
                                  : ''}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {task.controlLinks.length ? (
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Linked controls</p>
                        <div className="flex flex-wrap gap-2">
                          {task.controlLinks.map((link) => (
                            <Button
                              key={`${task.id}:${link.internalControlId}:${link.itemId}`}
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                props.onOpenControl(link.internalControlId);
                              }}
                            >
                              {link.nist80053Id ?? link.internalControlId}
                              {link.itemLabel ? ` · ${link.itemLabel}` : ''}
                            </Button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {task.policy ? (
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Linked policy</p>
                        <div className="rounded-md border p-3 text-sm">
                          <p className="font-medium">{task.policy.title}</p>
                          <p className="text-muted-foreground">
                            {task.policy.sourcePath} · {task.policy.support}
                          </p>
                        </div>
                      </div>
                    ) : null}

                    {task.vendor ? (
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Linked vendor</p>
                        <div className="rounded-md border p-3 text-sm">
                          <p className="font-medium">{task.vendor.title}</p>
                          <p className="text-muted-foreground">
                            {task.vendor.vendorKey} · {task.vendor.reviewStatus}
                          </p>
                        </div>
                      </div>
                    ) : null}

                    {task.findingsSummary ? (
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Findings posture</p>
                        <div className="rounded-md border p-3 text-sm text-muted-foreground">
                          <p>
                            Open findings: {task.findingsSummary.totalOpenCount}
                            {' · '}Critical: {task.findingsSummary.criticalOpenCount}
                            {' · '}Lower severity: {task.findingsSummary.lowerSeverityOpenCount}
                          </p>
                          <p>
                            Undispositioned open findings:{' '}
                            {task.findingsSummary.undispositionedCount}
                          </p>
                          <p>
                            Active tracked follow-up: {task.findingsSummary.activeFollowUpCount}
                            {' · '}Overdue follow-up: {task.findingsSummary.overdueFollowUpCount}
                          </p>
                          <p>
                            Blocking critical findings: {task.findingsSummary.blockingCriticalCount}
                          </p>
                        </div>
                      </div>
                    ) : null}

                    {task.policyControls.length ? (
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Mapped controls under this policy</p>
                        <div className="flex flex-wrap gap-2">
                          {task.policyControls.map((control) => (
                            <Button
                              key={`${task.id}:${control.internalControlId}`}
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                props.onOpenControl(control.internalControlId);
                              }}
                            >
                              {control.nist80053Id} · {control.support}
                            </Button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {task.taskType === 'document_upload' ? (
                      <div className="grid gap-3 md:grid-cols-3">
                        <Input
                          value={document.label}
                          onChange={(event) => {
                            props.onChangeDocumentField(task.id, 'label', event.target.value);
                          }}
                          placeholder="Document label"
                        />
                        <Input
                          value={document.url}
                          onChange={(event) => {
                            props.onChangeDocumentField(task.id, 'url', event.target.value);
                          }}
                          placeholder="Document URL"
                        />
                        <Input
                          value={document.version}
                          onChange={(event) => {
                            props.onChangeDocumentField(task.id, 'version', event.target.value);
                          }}
                          placeholder="Version"
                        />
                      </div>
                    ) : null}

                    {task.taskType !== 'automated_check' || task.allowException ? (
                      <Textarea
                        value={props.notes[task.id] ?? task.latestNote ?? ''}
                        onChange={(event) => {
                          props.onChangeNote(task.id, event.target.value);
                        }}
                        placeholder="Task note"
                      />
                    ) : null}

                    <div className="flex flex-wrap gap-2">
                      {task.taskType !== 'follow_up' && task.taskType !== 'automated_check' ? (
                        <Button
                          type="button"
                          disabled={props.busyAction !== null}
                          onClick={() => {
                            void props.onAttestTask(task);
                          }}
                        >
                          {props.busyAction === `${task.id}:attest`
                            ? 'Saving…'
                            : task.taskType === 'document_upload'
                              ? 'Upload / link latest document'
                              : 'Review and attest'}
                        </Button>
                      ) : null}
                      {task.allowException ? (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={props.busyAction !== null}
                          onClick={() => {
                            void props.onExceptionTask(task);
                          }}
                        >
                          {props.busyAction === `${task.id}:exception`
                            ? 'Saving…'
                            : 'Mark exception with note'}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="outline"
                        disabled={props.busyAction !== null}
                        onClick={() => {
                          void props.onOpenFollowUp(task);
                        }}
                      >
                        {props.busyAction === `${task.id}:follow-up`
                          ? 'Opening…'
                          : 'Open triggered follow-up'}
                      </Button>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        ) : (
          <p className="text-sm text-muted-foreground">No tasks in this group.</p>
        )}
      </CardContent>
    </Card>
  );
}

function CollapsedReviewTaskGroup(
  props: {
    description: string;
    tasks: ReviewTaskDetail[];
    title: string;
  } & Record<string, unknown>,
) {
  const [isOpen, setIsOpen] = useState(false);
  const doneCount = props.tasks.filter(
    (t) => t.status === 'completed' || t.status === 'exception',
  ).length;

  if (!isOpen) {
    return (
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>{props.title}</CardTitle>
            <Badge variant="outline">{props.tasks.length}</Badge>
            <Badge variant={doneCount === props.tasks.length ? 'default' : 'outline'}>
              {doneCount} of {props.tasks.length} done
            </Badge>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => {
                setIsOpen(true);
              }}
            >
              Expand
            </Button>
          </div>
          <CardDescription>{props.description}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <AdminSecurityReviewTaskGroup
      {...(props as Parameters<typeof AdminSecurityReviewTaskGroup>[0])}
      defaultCollapsed={undefined}
    />
  );
}
