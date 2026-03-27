import { useCallback, useState } from 'react';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
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
  getTodayDateInputValue,
  parseEvidenceDateInput,
} from '~/features/security/formatters';
import type {
  EvidenceReviewDueIntervalMonths,
  EvidenceSource,
  EvidenceSufficiency,
} from '~/features/security/types';

export type EvidenceMetadata = {
  evidenceDate: number;
  reviewDueIntervalMonths: EvidenceReviewDueIntervalMonths;
  source: EvidenceSource;
  sufficiency: EvidenceSufficiency;
};

export type AddEvidenceLinkPayload = EvidenceMetadata & {
  description: string | undefined;
  title: string;
  url: string;
};

export type AddEvidenceNotePayload = EvidenceMetadata & {
  description: string;
  title: string;
};

export type AddEvidenceFilePayload = EvidenceMetadata & {
  description: string | undefined;
  file: File;
  title: string;
};

export function AddEvidenceDialog(props: {
  busyKey: string | null;
  defaultReviewIntervalMonths?: EvidenceReviewDueIntervalMonths;
  description?: string;
  linkBusyKey: string;
  noteBusyKey: string;
  onAddLink: (payload: AddEvidenceLinkPayload) => Promise<void>;
  onAddNote: (payload: AddEvidenceNotePayload) => Promise<void>;
  onUploadFile: (payload: AddEvidenceFilePayload) => Promise<void>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
}) {
  const [tab, setTab] = useState<'link' | 'note' | 'file'>('link');
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkDescription, setLinkDescription] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [noteDescription, setNoteDescription] = useState('');
  const [evidenceDateInput, setEvidenceDateInput] = useState(() => getTodayDateInputValue());
  const [reviewDueIntervalMonths, setReviewDueIntervalMonths] =
    useState<EvidenceReviewDueIntervalMonths>(props.defaultReviewIntervalMonths ?? 12);
  const [source, setSource] = useState<EvidenceSource | ''>('internal_review');
  const [sufficiency, setSufficiency] = useState<EvidenceSufficiency>('sufficient');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const metadataIsComplete = evidenceDateInput.length > 0 && source !== '';

  const reset = useCallback(() => {
    setLinkTitle('');
    setLinkUrl('');
    setLinkDescription('');
    setNoteTitle('');
    setNoteDescription('');
    setEvidenceDateInput(getTodayDateInputValue());
    setReviewDueIntervalMonths(props.defaultReviewIntervalMonths ?? 12);
    setSource('internal_review');
    setSufficiency('sufficient');
    setShowAdvanced(false);
    setTab('link');
  }, [props.defaultReviewIntervalMonths]);

  function buildMetadata(): EvidenceMetadata | null {
    const evidenceDate = parseEvidenceDateInput(evidenceDateInput);
    if (evidenceDate === null || source === '') {
      return null;
    }
    return { evidenceDate, reviewDueIntervalMonths, source, sufficiency };
  }

  function handleClose() {
    props.onOpenChange(false);
    reset();
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        props.onOpenChange(open);
        if (!open) {
          reset();
        }
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{props.title ?? 'Add evidence'}</DialogTitle>
          {props.description ? <DialogDescription>{props.description}</DialogDescription> : null}
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="evidence-date">
              Evidence date
            </label>
            <Input
              id="evidence-date"
              type="date"
              value={evidenceDateInput}
              onChange={(event) => setEvidenceDateInput(event.target.value)}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowAdvanced((prev) => !prev)}
            className="text-xs"
          >
            {showAdvanced ? 'Hide options' : 'More options'}
          </Button>
          {showAdvanced && (
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="evidence-review-due">
                  Review due
                </label>
                <Select
                  value={String(reviewDueIntervalMonths)}
                  onValueChange={(value) =>
                    setReviewDueIntervalMonths(Number(value) as EvidenceReviewDueIntervalMonths)
                  }
                >
                  <SelectTrigger id="evidence-review-due" className="w-full">
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
                <label className="text-sm font-medium" htmlFor="evidence-source">
                  Source
                </label>
                <Select
                  value={source}
                  onValueChange={(value) => setSource(value as EvidenceSource)}
                >
                  <SelectTrigger id="evidence-source" className="w-full">
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
                <label className="text-sm font-medium" htmlFor="evidence-sufficiency">
                  Sufficiency
                </label>
                <Select
                  value={sufficiency}
                  onValueChange={(value) => setSufficiency(value as EvidenceSufficiency)}
                >
                  <SelectTrigger id="evidence-sufficiency" className="w-full">
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
          )}
          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as 'link' | 'note' | 'file')}
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
                <Button type="button" variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={
                    props.busyKey === props.linkBusyKey ||
                    !metadataIsComplete ||
                    linkTitle.trim().length === 0 ||
                    linkUrl.trim().length === 0
                  }
                  onClick={() => {
                    const metadata = buildMetadata();
                    if (!metadata) return;
                    void props
                      .onAddLink({
                        ...metadata,
                        description: linkDescription.trim() || undefined,
                        title: linkTitle.trim(),
                        url: linkUrl.trim(),
                      })
                      .then(() => {
                        handleClose();
                      });
                  }}
                >
                  {props.busyKey === props.linkBusyKey ? 'Saving…' : 'Attach link'}
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
                <Button type="button" variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={
                    props.busyKey === props.noteBusyKey ||
                    !metadataIsComplete ||
                    noteTitle.trim().length === 0 ||
                    noteDescription.trim().length === 0
                  }
                  onClick={() => {
                    const metadata = buildMetadata();
                    if (!metadata) return;
                    void props
                      .onAddNote({
                        ...metadata,
                        description: noteDescription.trim(),
                        title: noteTitle.trim(),
                      })
                      .then(() => {
                        handleClose();
                      });
                  }}
                >
                  {props.busyKey === props.noteBusyKey ? 'Saving…' : 'Attach note'}
                </Button>
              </DialogFooter>
            </TabsContent>

            <TabsContent value="file" className="space-y-2">
              <Input
                type="file"
                accept=".jpg,.jpeg,.png,.gif,.webp,.txt,.csv,.pdf,image/jpeg,image/png,image/gif,image/webp,text/plain,text/csv,application/pdf"
                onChange={(event) => {
                  const selectedFile = event.target.files?.[0];
                  const metadata = buildMetadata();
                  if (!selectedFile || !metadata) {
                    event.target.value = '';
                    return;
                  }
                  void props
                    .onUploadFile({
                      ...metadata,
                      description: undefined,
                      file: selectedFile,
                      title: selectedFile.name,
                    })
                    .finally(() => {
                      event.target.value = '';
                    });
                }}
              />
              <p className="text-xs text-muted-foreground">
                Allowed file types: PDF, TXT, CSV, JPG, PNG, GIF, WEBP.
              </p>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={handleClose}>
                  Close
                </Button>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
