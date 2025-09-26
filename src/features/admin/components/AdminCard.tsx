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
  const cardClasses = `block p-6 bg-white rounded-lg shadow hover:shadow-lg transition-shadow border cursor-pointer ${
    destructive ? 'border-red-200 hover:border-red-300' : 'border-gray-200'
  }`;

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cardClasses}>
        <div className="flex items-start justify-between">
          <div>
            <h3
              className={`text-left text-lg leading-6 font-medium mb-2 ${
                destructive ? 'text-red-900' : 'text-gray-900'
              }`}
            >
              {title}
            </h3>
            <p className={`text-sm ${destructive ? 'text-red-600' : 'text-gray-600'}`}>
              {description}
            </p>
          </div>
          {destructive && <Trash2 className="h-5 w-5 text-red-500 flex-shrink-0 ml-2" />}
        </div>
      </button>
    );
  }

  return (
    <Link to={href} className={cardClasses}>
      <h3 className="text-left text-lg leading-6 font-medium text-gray-900 mb-2">{title}</h3>
      <p className="text-gray-600">{description}</p>
    </Link>
  );
}
