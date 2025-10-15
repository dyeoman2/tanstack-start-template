import { cn } from '~/lib/utils';

interface PageHeaderProps {
  title: string;
  description?: string | React.ReactNode;
  className?: string;
  titleClassName?: string;
  descriptionClassName?: string;
  actions?: React.ReactNode;
}

export function PageHeader({
  title,
  description,
  className,
  titleClassName,
  descriptionClassName,
  actions,
}: PageHeaderProps) {
  return (
    <div className={cn('mb-8', className)}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className={cn('text-2xl font-bold text-foreground', titleClassName)}>{title}</h1>
          {description && (
            <div className={cn('mt-2 text-sm text-muted-foreground', descriptionClassName)}>
              {description}
            </div>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
