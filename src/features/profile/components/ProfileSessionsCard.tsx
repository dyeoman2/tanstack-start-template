import { formatDistanceToNow } from 'date-fns';
import {
  ChevronDown,
  ChevronUp,
  Laptop,
  Loader2,
  MapPin,
  Monitor,
  Smartphone,
  Tablet,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Skeleton } from '~/components/ui/skeleton';
import { useToast } from '~/components/ui/toast';
import { signOut } from '~/features/auth/auth-client';
import {
  type ProfileSession,
  useProfileSessions,
} from '~/features/profile/hooks/useProfileSessions';

type SessionView = {
  id: string;
  isCurrent: boolean;
  updatedAt: number;
  deviceLabel: string;
  secondaryLabel: string;
  locationLabel: string | null;
  relativeLastActive: string;
  lastActiveLabel: string;
  createdLabel: string;
  icon: typeof Laptop;
};

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function ProfileSessionsCard() {
  const { showToast } = useToast();
  const { sessions, isPending, error, revokeSession, revokeOtherSessions } = useProfileSessions();
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [showOtherSessions, setShowOtherSessions] = useState(false);
  const [isRevokingOthers, setIsRevokingOthers] = useState(false);
  const sessionViews = useMemo(() => {
    return sessions
      .map((session) => buildSessionView(session))
      .sort((left, right) => {
        if (left.isCurrent !== right.isCurrent) {
          return left.isCurrent ? -1 : 1;
        }

        return right.updatedAt - left.updatedAt;
      });
  }, [sessions]);

  const current = sessionViews.find((session) => session.isCurrent) ?? null;
  const otherSessions = sessionViews.filter((session) => !session.isCurrent);

  const handleSignOutCurrent = async () => {
    try {
      await signOut();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to sign out';
      showToast(message, 'error');
    }
  };

  const handleRevokeSession = async (session: SessionView) => {
    if (session.isCurrent) {
      await handleSignOutCurrent();
      return;
    }

    setPendingSessionId(session.id);

    try {
      const success = await revokeSession(session.id);
      if (!success) {
        throw new Error('Failed to revoke session');
      }
    } catch {
      // Toasts and error state are handled by the hook.
    } finally {
      setPendingSessionId(null);
    }
  };

  const handleRevokeOtherSessions = async () => {
    setIsRevokingOthers(true);

    try {
      const success = await revokeOtherSessions();
      if (!success) {
        throw new Error('Failed to revoke other sessions');
      }
    } catch {
      // Toasts and error state are handled by the hook.
    } finally {
      setIsRevokingOthers(false);
    }
  };

  return (
    <Card className="overflow-hidden rounded-xl border border-border shadow-sm">
      <CardHeader className="border-b">
        <div className="space-y-1">
          <CardTitle className="text-base font-semibold">Sessions</CardTitle>
          <CardDescription>
            Review where your account is active and revoke devices you no longer trust.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 px-6 py-5">
        {isPending ? <SessionsLoadingState /> : null}

        {!isPending ? (
          <div className="space-y-4">
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            {current ? (
              <CurrentSessionPanel session={current} onSignOut={handleSignOutCurrent} />
            ) : (
              <Alert>
                <AlertDescription>No current session found.</AlertDescription>
              </Alert>
            )}

            {otherSessions.length > 0 ? (
              <section className="space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    type="button"
                    className="flex items-center gap-2 text-left"
                    onClick={() => setShowOtherSessions((value) => !value)}
                  >
                    <span className="text-sm font-semibold text-foreground">
                      Other sessions ({otherSessions.length})
                    </span>
                    {showOtherSessions ? (
                      <ChevronUp className="size-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="size-4 text-muted-foreground" />
                    )}
                  </button>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void handleRevokeOtherSessions();
                    }}
                    disabled={otherSessions.length === 0 || isRevokingOthers}
                  >
                    {isRevokingOthers ? (
                      <>
                        <Loader2 className="animate-spin" />
                        Revoking...
                      </>
                    ) : (
                      'Revoke other sessions'
                    )}
                  </Button>
                </div>

                {showOtherSessions ? (
                  <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-background">
                    {otherSessions.map((session) => (
                      <OtherSessionRow
                        key={session.id}
                        session={session}
                        isPending={pendingSessionId === session.id}
                        onRevoke={() => {
                          void handleRevokeSession(session);
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {otherSessions.length} session{otherSessions.length === 1 ? '' : 's'} still have
                    access.
                  </p>
                )}
              </section>
            ) : !current ? (
              <Alert>
                <AlertDescription>No active sessions found.</AlertDescription>
              </Alert>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CurrentSessionPanel({
  session,
  onSignOut,
}: {
  session: SessionView;
  onSignOut: () => Promise<void>;
}) {
  return (
    <section>
      <div className="overflow-hidden rounded-xl border border-border bg-background">
        <SessionRow
          session={session}
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void onSignOut();
              }}
            >
              Sign out
            </Button>
          }
          current
        />
      </div>
    </section>
  );
}

function OtherSessionRow({
  session,
  isPending,
  onRevoke,
}: {
  session: SessionView;
  isPending: boolean;
  onRevoke: () => void;
}) {
  return (
    <SessionRow
      session={session}
      action={
        <Button
          type="button"
          variant="ghost-destructive"
          size="sm"
          className="sm:self-center"
          disabled={isPending}
          onClick={onRevoke}
        >
          {isPending ? (
            <>
              <Loader2 className="animate-spin" />
              Revoking...
            </>
          ) : (
            'Revoke'
          )}
        </Button>
      }
    />
  );
}

function SessionRow({
  session,
  action,
  current = false,
}: {
  session: SessionView;
  action: React.ReactNode;
  current?: boolean;
}) {
  const Icon = session.icon;

  return (
    <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <div className="rounded-2xl bg-muted/80 p-2.5">
          <Icon className="size-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-foreground">{session.deviceLabel}</p>
            {current ? (
              <Badge variant="success" className="rounded-full px-2 py-0 text-[11px]">
                Active now
              </Badge>
            ) : (
              <Badge variant="outline" className="rounded-full px-2 py-0 text-[11px]">
                {session.relativeLastActive}
              </Badge>
            )}
          </div>
          <p className="truncate text-sm text-muted-foreground/90">{session.secondaryLabel}</p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1">
              <MapPin className="size-3.5" />
              {session.locationLabel ?? 'Unknown location'}
            </span>
            {!current ? (
              <span className="rounded-full bg-muted px-2 py-1">{session.lastActiveLabel}</span>
            ) : null}
            <span className="rounded-full bg-muted px-2 py-1">Started {session.createdLabel}</span>
          </div>
        </div>
      </div>

      {action}
    </div>
  );
}

function SessionsLoadingState() {
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border p-4">
        <div className="flex items-start gap-3">
          <Skeleton className="size-10 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-4 w-56" />
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            className="flex items-center gap-3 border-b border-border px-4 py-4 last:border-b-0"
          >
            <Skeleton className="size-9 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-56" />
            </div>
            <Skeleton className="h-8 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

function buildSessionView(session: ProfileSession): SessionView {
  const parsedAgent = parseUserAgent(session.userAgent);
  const icon = getSessionIcon(parsedAgent.deviceType);

  const deviceLabel =
    parsedAgent.deviceName ||
    [parsedAgent.osName, parsedAgent.browserName].filter(Boolean).join(' on ') ||
    'Unknown device';

  const secondaryLabel =
    [formatDeviceType(parsedAgent.deviceType), parsedAgent.osName, parsedAgent.browserName]
      .filter(Boolean)
      .join(' · ') || 'Unknown client';

  const lastActiveAt = new Date(session.updatedAt);
  const createdAt = new Date(session.createdAt);

  return {
    id: session.id,
    isCurrent: session.isCurrent,
    updatedAt: lastActiveAt.getTime(),
    deviceLabel,
    secondaryLabel,
    locationLabel: session.ipAddress ?? null,
    relativeLastActive: formatRelativeTime(lastActiveAt),
    lastActiveLabel: `Last active ${dateTimeFormatter.format(lastActiveAt)}`,
    createdLabel: dateTimeFormatter.format(createdAt),
    icon,
  };
}

function parseUserAgent(userAgent: string | null | undefined) {
  const value = userAgent?.toLowerCase() ?? '';

  const browserName = detectBrowser(value);
  const osName = detectOperatingSystem(value);
  const deviceType = detectDeviceType(value);

  return {
    browserName,
    osName,
    deviceType,
    deviceName: deviceType === 'mobile' || deviceType === 'tablet' ? detectDeviceName(value) : null,
  };
}

function formatRelativeTime(date: Date) {
  return formatDistanceToNow(date, { addSuffix: true });
}

function detectBrowser(userAgent: string) {
  if (userAgent.includes('edg/')) {
    return 'Edge';
  }
  if (userAgent.includes('chrome/') && !userAgent.includes('edg/')) {
    return 'Chrome';
  }
  if (userAgent.includes('safari/') && !userAgent.includes('chrome/')) {
    return 'Safari';
  }
  if (userAgent.includes('firefox/')) {
    return 'Firefox';
  }
  if (userAgent.includes('tauri-plugin-http')) {
    return 'Desktop app';
  }

  return null;
}

function detectOperatingSystem(userAgent: string) {
  if (userAgent.includes('mac os x') || userAgent.includes('macintosh')) {
    return 'macOS';
  }
  if (userAgent.includes('iphone') || userAgent.includes('ipad') || userAgent.includes('cpu os')) {
    return 'iOS';
  }
  if (userAgent.includes('android')) {
    return 'Android';
  }
  if (userAgent.includes('windows nt')) {
    return 'Windows';
  }
  if (userAgent.includes('linux')) {
    return 'Linux';
  }

  return null;
}

function detectDeviceType(userAgent: string) {
  if (userAgent.includes('ipad') || userAgent.includes('tablet')) {
    return 'tablet';
  }
  if (
    userAgent.includes('iphone') ||
    userAgent.includes('android') ||
    userAgent.includes('mobile')
  ) {
    return 'mobile';
  }
  if (userAgent.includes('smart-tv') || userAgent.includes('smarttv') || userAgent.includes('tv')) {
    return 'smarttv';
  }

  return null;
}

function detectDeviceName(userAgent: string) {
  if (userAgent.includes('iphone')) {
    return 'iPhone';
  }
  if (userAgent.includes('ipad')) {
    return 'iPad';
  }
  if (userAgent.includes('android')) {
    return 'Android device';
  }

  return null;
}

function formatDeviceType(deviceType: string | undefined | null) {
  if (!deviceType) {
    return 'Desktop';
  }

  switch (deviceType) {
    case 'mobile':
      return 'Mobile';
    case 'tablet':
      return 'Tablet';
    case 'smarttv':
      return 'TV';
    case 'wearable':
      return 'Wearable';
    default:
      return 'Device';
  }
}

function getSessionIcon(deviceType: string | undefined | null) {
  switch (deviceType) {
    case 'mobile':
      return Smartphone;
    case 'tablet':
      return Tablet;
    case 'smarttv':
      return Monitor;
    default:
      return Laptop;
  }
}
