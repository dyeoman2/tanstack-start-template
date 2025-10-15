interface MetricCardProps {
  title: string;
  value: string;
  onClick?: () => void;
}

export function MetricCard({ title, value, onClick }: MetricCardProps) {
  const isClickable = !!onClick;

  const content = (
    <div className="p-5">
      <div className="flex items-center">
        <div className="flex-1">
          <dl>
            <dt className="text-sm font-medium text-muted-foreground truncate">{title}</dt>
            <dd className="text-lg font-medium text-foreground">{value}</dd>
          </dl>
        </div>
      </div>
    </div>
  );

  if (isClickable) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="bg-card border border-border overflow-hidden shadow rounded-lg hover:bg-accent transition-colors duration-200 cursor-pointer w-full text-left"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="bg-card border border-border overflow-hidden shadow rounded-lg">{content}</div>
  );
}

export function SkeletonCard({ title }: { title: string }) {
  void title; // Mark as intentionally unused for future extensibility
  return (
    <div className="bg-card border border-border overflow-hidden shadow rounded-lg">
      <div className="p-5">
        <div className="animate-pulse">
          <div className="h-4 bg-muted rounded mb-2 w-3/4" />
          <div className="h-8 bg-muted rounded w-1/2" />
        </div>
      </div>
    </div>
  );
}
