import { useCallback, useEffect, useRef, useState } from 'react';
import { signOut } from '~/features/auth/auth-client';

/** HIPAA-recommended inactivity timeout: 15 minutes. */
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;

/** Show warning dialog 2 minutes before automatic sign-out. */
const WARNING_BEFORE_MS = 2 * 60 * 1000;

/** How often we check for inactivity (seconds). */
const CHECK_INTERVAL_MS = 1_000;

/** Throttle activity event updates to avoid excessive writes. */
const ACTIVITY_THROTTLE_MS = 1_000;

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'] as const;

export interface InactivityState {
  isWarning: boolean;
  remainingSeconds: number;
  dismissWarning: () => void;
  signOutNow: () => void;
}

export function useInactivityTimeout(): InactivityState {
  const lastActivityRef = useRef(Date.now());
  const throttleRef = useRef(0);
  const [isWarning, setIsWarning] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(Math.ceil(INACTIVITY_TIMEOUT_MS / 1000));

  const resetActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    setIsWarning(false);
    setRemainingSeconds(Math.ceil(INACTIVITY_TIMEOUT_MS / 1000));
  }, []);

  const handleSignOut = useCallback(() => {
    void signOut({ fetchOptions: { throw: false } });
  }, []);

  // Track user activity events
  useEffect(() => {
    function onActivity() {
      const now = Date.now();

      if (now - throttleRef.current < ACTIVITY_THROTTLE_MS) {
        return;
      }

      throttleRef.current = now;
      lastActivityRef.current = now;

      // Only clear warning if user interacts outside the dialog
      // (dialog has its own dismiss button)
    }

    for (const event of ACTIVITY_EVENTS) {
      document.addEventListener(event, onActivity, { passive: true });
    }

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        document.removeEventListener(event, onActivity);
      }
    };
  }, []);

  // Interval to check inactivity and update state
  useEffect(() => {
    const intervalId = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      const remaining = Math.max(0, INACTIVITY_TIMEOUT_MS - elapsed);
      const remainingSec = Math.ceil(remaining / 1000);

      setRemainingSeconds(remainingSec);

      if (remaining <= 0) {
        handleSignOut();
        return;
      }

      if (remaining <= WARNING_BEFORE_MS) {
        setIsWarning(true);
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [handleSignOut]);

  return {
    isWarning,
    remainingSeconds,
    dismissWarning: resetActivity,
    signOutNow: handleSignOut,
  };
}
