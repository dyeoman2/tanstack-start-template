import { CheckCircle2, ChevronDown, ChevronUp, Circle, type LucideIcon } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';

interface CollapsibleSectionCardProps {
  title: string | ReactNode;
  icon: LucideIcon;
  isCompleted: boolean;
  isEditing?: boolean;
  children: ReactNode;
}

/**
 * Reusable collapsible card wrapper for application sections.
 * Provides consistent styling and behavior across Agent Designation, Property Owner, etc.
 */
export function CollapsibleSectionCard({
  title,
  icon: Icon,
  isCompleted,
  isEditing = false,
  children,
}: CollapsibleSectionCardProps) {
  const [isExpanded, setIsExpanded] = useState(!isCompleted);

  // Auto-expand when not completed
  useEffect(() => {
    if (!isCompleted) {
      setIsExpanded(true);
    }
  }, [isCompleted]);

  const handleToggle = () => {
    if (!isEditing && !isCompleted) return;
    setIsExpanded(!isExpanded);
  };

  return (
    <Card className="relative">
      <CardHeader
        className={isEditing || isCompleted ? 'cursor-pointer' : ''}
        onClick={handleToggle}
      >
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isCompleted ? (
              <CheckCircle2 className="h-5 w-5 text-success" />
            ) : (
              <Circle className="h-5 w-5 text-muted-foreground" />
            )}
            <Icon className="h-5 w-5" />
            {title}
          </div>
          {(isEditing || isCompleted) && (
            <div className="flex items-center">
              {isExpanded ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          )}
        </CardTitle>
      </CardHeader>

      {isExpanded && <CardContent className="space-y-4">{children}</CardContent>}
    </Card>
  );
}
