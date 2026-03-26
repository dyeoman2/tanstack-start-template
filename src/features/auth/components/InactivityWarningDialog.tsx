import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog';
import { useInactivityTimeout } from '~/features/auth/hooks/useInactivityTimeout';

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
  }

  return `${String(seconds)}s`;
}

export function InactivityWarningDialog() {
  const { isWarning, remainingSeconds, dismissWarning, signOutNow } = useInactivityTimeout();

  return (
    <AlertDialog open={isWarning}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Session timeout</AlertDialogTitle>
          <AlertDialogDescription>
            You will be signed out in{' '}
            <span className="font-semibold tabular-nums">{formatTime(remainingSeconds)}</span> due
            to inactivity. Move your mouse or press any key to stay signed in.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={dismissWarning}>Stay signed in</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={signOutNow}>
            Sign out now
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
