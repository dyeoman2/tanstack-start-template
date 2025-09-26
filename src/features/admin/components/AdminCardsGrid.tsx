import { AdminCard } from './AdminCard';

interface AdminCardsGridProps {
  onTruncateClick: () => void;
}

export function AdminCardsGrid({ onTruncateClick }: AdminCardsGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <AdminCard
        title="User Management"
        description="Manage users and their roles"
        href="/admin/users"
      />

      <AdminCard
        title="System Statistics"
        description="View system-wide statistics"
        href="/admin/stats"
      />

      <AdminCard
        title="Truncate Data"
        description="Reset all financial data for testing"
        onClick={onTruncateClick}
        destructive
      />
    </div>
  );
}
