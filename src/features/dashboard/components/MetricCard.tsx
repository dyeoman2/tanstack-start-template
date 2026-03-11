import { Spinner } from '~/components/ui/spinner';

interface MetricCardProps {
  title: string;
  value?: string;
  isLoading?: boolean;
  onClick?: () => void;
}

export function MetricCard({ title, value, isLoading = false, onClick }: MetricCardProps) {
  const isClickable = !!onClick;

  const content = (
    <div className="p-5">
      <div className="flex items-center">
        <div className="flex-1">
          <dl>
            <dt className="text-sm font-medium text-muted-foreground truncate">{title}</dt>
            <dd className="flex h-[1.75rem] items-center text-lg font-medium text-foreground">
              {isLoading ? <Spinner className="size-[1.125rem]" /> : value}
            </dd>
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
