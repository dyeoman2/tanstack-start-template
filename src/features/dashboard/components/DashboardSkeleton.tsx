export function DashboardSkeleton() {
  return (
    <div className="px-4 py-8">
      <div className="animate-pulse">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <div className="h-10 bg-gray-300 rounded w-32" />
        </div>

        {/* Metrics Cards */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3 mb-8">
          {['metric-1', 'metric-2', 'metric-3'].map((id) => (
            <div key={id} className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="h-4 bg-gray-300 rounded mb-2 w-3/4" />
                <div className="h-8 bg-gray-300 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>

        {/* Content Area */}
        <div className="bg-white shadow overflow-hidden sm:rounded-md">
          <div className="px-4 py-5 sm:p-6">
            <div className="space-y-4">
              {['row-1', 'row-2', 'row-3', 'row-4', 'row-5'].map((id) => (
                <div key={id} className="flex space-x-4">
                  <div className="h-4 bg-gray-300 rounded flex-1" />
                  <div className="h-4 bg-gray-300 rounded w-20" />
                  <div className="h-4 bg-gray-300 rounded w-16" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
