import { useCallback, useState } from 'react';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '~/components/ui/sheet';
import { Textarea } from '~/components/ui/textarea';
import type { ReviewTaskDetail } from '~/features/security/types';

export function AdminSecurityBatchReview({
  busyAction,
  onAttestTask,
  onOpenChange,
  open,
  tasks,
}: {
  busyAction: string | null;
  onAttestTask: (task: ReviewTaskDetail) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  tasks: ReviewTaskDetail[];
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [attestedIds, setAttestedIds] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');

  const totalTasks = tasks.length;
  const isFinished = currentIndex >= totalTasks;
  const currentTask = isFinished ? null : tasks[currentIndex];

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setCurrentIndex(0);
        setAttestedIds(new Set());
        setNote('');
      }
      onOpenChange(open);
    },
    [onOpenChange],
  );

  const advanceToNext = useCallback(() => {
    setNote('');
    setCurrentIndex((prev) => prev + 1);
  }, []);

  const handleAttestAndNext = useCallback(async () => {
    if (!currentTask) {
      return;
    }
    await onAttestTask(currentTask);
    setAttestedIds((prev) => new Set(prev).add(currentTask.id));
    advanceToNext();
  }, [advanceToNext, currentTask, onAttestTask]);

  const handleSkip = useCallback(() => {
    advanceToNext();
  }, [advanceToNext]);

  const handleDone = useCallback(() => {
    handleOpenChange(false);
  }, [handleOpenChange]);

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>
            Batch review — {isFinished ? totalTasks : currentIndex + 1} of {totalTasks}
          </SheetTitle>
          <SheetDescription>
            Review and attest tasks sequentially. Skip any task you want to revisit later.
          </SheetDescription>
        </SheetHeader>

        {/* Progress bar */}
        <div className="space-y-1 px-1">
          <div className="h-2 w-full rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{
                width: `${totalTasks > 0 ? Math.round(((isFinished ? totalTasks : currentIndex) / totalTasks) * 100) : 0}%`,
              }}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {isFinished
              ? `${attestedIds.size} of ${totalTasks} tasks attested`
              : `Reviewing task ${currentIndex + 1} of ${totalTasks}`}
          </p>
        </div>

        {isFinished ? (
          <div className="space-y-4 p-1">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              <p className="font-medium">Batch review complete</p>
              <p className="mt-1">
                {attestedIds.size} of {totalTasks} task{totalTasks === 1 ? '' : 's'} attested.
              </p>
            </div>
            <Button type="button" onClick={handleDone}>
              Close
            </Button>
          </div>
        ) : currentTask ? (
          <div className="space-y-4 p-1">
            {/* Task header */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold">{currentTask.title}</h3>
                {currentTask.vendor ? (
                  <Badge variant="secondary">{currentTask.vendor.title}</Badge>
                ) : null}
              </div>
              {currentTask.description ? (
                <p className="text-sm text-muted-foreground">{currentTask.description}</p>
              ) : null}
            </div>

            {/* Evidence links */}
            {currentTask.evidenceLinks.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">Linked evidence</p>
                <div className="space-y-2">
                  {currentTask.evidenceLinks.map((link) => (
                    <div key={link.id} className="rounded-md border p-3 text-sm">
                      <p className="font-medium">{link.sourceLabel}</p>
                      <p className="text-muted-foreground">
                        Linked {new Date(link.linkedAt).toLocaleString()}
                        {link.freshAt ? ` · Fresh ${new Date(link.freshAt).toLocaleString()}` : ''}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Control links */}
            {currentTask.controlLinks.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">Linked controls</p>
                <div className="flex flex-wrap gap-2">
                  {currentTask.controlLinks.map((link) => (
                    <Badge
                      key={`${currentTask.id}:${link.internalControlId}:${link.itemId}`}
                      variant="outline"
                    >
                      {link.nist80053Id ?? link.internalControlId}
                      {link.itemLabel ? ` · ${link.itemLabel}` : ''}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Policy info */}
            {currentTask.policy ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">Linked policy</p>
                <div className="rounded-md border p-3 text-sm">
                  <p className="font-medium">{currentTask.policy.title}</p>
                  <p className="text-muted-foreground">
                    {currentTask.policy.sourcePath} · {currentTask.policy.support}
                  </p>
                </div>
              </div>
            ) : null}

            {/* Vendor info */}
            {currentTask.vendor ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">Linked vendor</p>
                <div className="rounded-md border p-3 text-sm">
                  <p className="font-medium">{currentTask.vendor.title}</p>
                  <p className="text-muted-foreground">
                    {currentTask.vendor.vendorKey} · {currentTask.vendor.reviewStatus}
                  </p>
                </div>
              </div>
            ) : null}

            {/* Note textarea */}
            <Textarea
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
              placeholder="Optional note for this task"
            />

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={busyAction !== null}
                onClick={() => {
                  void handleAttestAndNext();
                }}
              >
                {busyAction === `${currentTask.id}:attest`
                  ? 'Saving…'
                  : currentIndex < totalTasks - 1
                    ? 'Attest & next'
                    : 'Attest & finish'}
              </Button>
              <Button type="button" variant="outline" onClick={handleSkip}>
                Skip
              </Button>
              <Button type="button" variant="outline" onClick={handleDone}>
                Done
              </Button>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
