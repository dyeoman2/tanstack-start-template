type IsoDateString = string & { __brand: 'IsoDateString' };

interface RecentActivityItem {
  id: string;
  type: 'signup' | 'login' | 'purchase' | 'unknown';
  userEmail: string;
  description: string;
  timestamp: IsoDateString;
}

interface RecentActivityProps {
  activities: RecentActivityItem[];
}

export function RecentActivity({ activities }: RecentActivityProps) {
  if (!activities || activities.length === 0) {
    return null;
  }

  return (
    <div className="bg-card border border-border shadow overflow-hidden sm:rounded-md">
      <div className="px-4 py-5 sm:px-6">
        <h3 className="text-lg leading-6 font-medium text-foreground mb-4">Recent Activity</h3>
        <div className="space-y-3">
          {activities.slice(0, 4).map((activity) => (
            <div
              key={activity.id}
              className="flex items-center justify-between py-2 border-b border-border last:border-b-0"
            >
              <div className="flex items-center space-x-3">
                <div
                  className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium ${
                    activity.type === 'signup'
                      ? 'bg-primary/10 text-primary'
                      : activity.type === 'purchase'
                        ? 'bg-primary/10 text-primary'
                        : activity.type === 'unknown'
                          ? 'bg-muted text-muted-foreground'
                          : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {activity.type === 'signup'
                    ? 'S'
                    : activity.type === 'purchase'
                      ? 'P'
                      : activity.type === 'unknown'
                        ? '?'
                        : 'L'}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{activity.userEmail}</p>
                  <p className="text-xs text-muted-foreground">{activity.description}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">
                  {new Date(activity.timestamp).toLocaleString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
