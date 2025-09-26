interface MetricCardProps {
  title: string;
  value: string;
  subtitle?: string;
  change?: string;
  changeType?: 'positive' | 'negative';
}

export function MetricCard({ title, value, subtitle, change, changeType }: MetricCardProps) {
  return (
    <div className="bg-white overflow-hidden shadow rounded-lg">
      <div className="p-5">
        <div className="flex items-center">
          <div className="flex-1">
            <dl>
              <dt className="text-sm font-medium text-gray-500 truncate">{title}</dt>
              <dd className="text-lg font-medium text-gray-900">{value}</dd>
              {subtitle && <dd className="text-sm text-gray-500">{subtitle}</dd>}
              {change && (
                <dd
                  className={`text-sm ${changeType === 'positive' ? 'text-green-600' : 'text-red-600'}`}
                >
                  {change}
                </dd>
              )}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SkeletonCard({ title }: { title: string }) {
  void title; // Mark as intentionally unused for future extensibility
  return (
    <div className="bg-white overflow-hidden shadow rounded-lg">
      <div className="p-5">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-300 rounded mb-2 w-3/4" />
          <div className="h-8 bg-gray-300 rounded w-1/2" />
        </div>
      </div>
    </div>
  );
}
