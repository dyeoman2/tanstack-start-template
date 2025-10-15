import { Link } from '@tanstack/react-router';
import { Trash2 } from 'lucide-react';

interface AdminCardProps {
  title: string;
  description: string;
  href?: string;
  onClick?: () => void;
  destructive?: boolean;
}

export function AdminCard({ title, description, href, onClick, destructive }: AdminCardProps) {
  const cardClasses = `block p-6 bg-card rounded-lg shadow hover:shadow-lg transition-shadow border cursor-pointer ${
    destructive ? 'border-destructive/30 hover:border-destructive/50' : 'border-border'
  }`;

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cardClasses}>
        <div className="flex items-start justify-between">
          <div>
            <h3
              className={`text-left text-lg leading-6 font-medium mb-2 ${
                destructive ? 'text-destructive' : 'text-foreground'
              }`}
            >
              {title}
            </h3>
            <p className={`text-sm ${destructive ? 'text-destructive' : 'text-muted-foreground'}`}>
              {description}
            </p>
          </div>
          {destructive && <Trash2 className="h-5 w-5 text-destructive flex-shrink-0 ml-2" />}
        </div>
      </button>
    );
  }

  return (
    <Link to={href} className={cardClasses}>
      <h3 className="text-left text-lg leading-6 font-medium text-foreground mb-2">{title}</h3>
      <p className="text-muted-foreground">{description}</p>
    </Link>
  );
}
