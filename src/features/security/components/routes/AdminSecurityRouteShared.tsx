import { Spinner } from '~/components/ui/spinner';

export function DetailLoadingState({ label }: { label: string }) {
  return (
    <div className="flex min-h-32 items-center justify-center p-4 text-sm text-muted-foreground">
      <Spinner className="size-5" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
