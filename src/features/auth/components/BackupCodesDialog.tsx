import { Check, Copy, Download, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';

type BackupCodesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  backupCodes: string[];
  onContinue: () => void;
  isContinuing?: boolean;
};

export function BackupCodesDialog({
  open,
  onOpenChange,
  backupCodes,
  onContinue,
  isContinuing = false,
}: BackupCodesDialogProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [didCopyBackupCodes, setDidCopyBackupCodes] = useState(false);
  const [didDownloadBackupCodes, setDidDownloadBackupCodes] = useState(false);

  useEffect(() => {
    if (!open) {
      setMessage(null);
      setDidCopyBackupCodes(false);
      setDidDownloadBackupCodes(false);
    }
  }, [open]);

  async function handleCopyBackupCodes() {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      setMessage('Copy is unavailable in this browser.');
      setDidCopyBackupCodes(false);
      return;
    }

    try {
      await navigator.clipboard.writeText(backupCodes.join('\n'));
      setMessage(null);
      setDidCopyBackupCodes(true);
      window.setTimeout(() => {
        setDidCopyBackupCodes(false);
      }, 2000);
    } catch {
      setMessage('Unable to copy backup codes.');
      setDidCopyBackupCodes(false);
    }
  }

  function handleDownloadBackupCodes() {
    if (typeof window === 'undefined') {
      return;
    }

    const fileContents = `${backupCodes.join('\n')}\n`;
    const blob = new Blob([fileContents], { type: 'text/plain;charset=utf-8' });
    const objectUrl = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = 'backup-codes.txt';
    anchor.click();
    window.URL.revokeObjectURL(objectUrl);
    setMessage(null);
    setDidDownloadBackupCodes(true);
    window.setTimeout(() => {
      setDidDownloadBackupCodes(false);
    }, 2000);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Save your backup codes</DialogTitle>
          <DialogDescription>
            Keep these in a secure place. You can use them if you lose access to your authenticator.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          After this, you&apos;ll confirm the 6-digit code from your authenticator app to finish
          security setup.
        </p>
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        <div className="grid grid-cols-2 gap-2">
          {backupCodes.map((code) => (
            <div
              key={code}
              className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-center font-mono text-sm"
            >
              {code}
            </div>
          ))}
        </div>
        <DialogFooter className="flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleCopyBackupCodes()}
              aria-label={didCopyBackupCodes ? 'Backup codes copied' : 'Copy codes'}
              title={didCopyBackupCodes ? 'Copied' : 'Copy codes'}
            >
              {didCopyBackupCodes ? <Check className="size-4" /> : <Copy className="size-4" />}
              Copy codes
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleDownloadBackupCodes}
              aria-label={didDownloadBackupCodes ? 'Backup codes downloaded' : 'Download codes'}
              title={didDownloadBackupCodes ? 'Downloaded' : 'Download codes'}
            >
              {didDownloadBackupCodes ? (
                <Check className="size-4" />
              ) : (
                <Download className="size-4" />
              )}
              Download codes
            </Button>
          </div>
          <Button type="button" onClick={onContinue} disabled={isContinuing}>
            {isContinuing ? <Loader2 className="size-4 animate-spin" /> : null}
            {isContinuing ? 'Continuing...' : 'Continue'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
