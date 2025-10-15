import { Edit, Trash2 } from 'lucide-react';
import { Button } from '~/components/ui/button';

interface EditActionButtonProps {
  onClick: () => void;
  className?: string;
}

export function EditActionButton({ onClick, className }: EditActionButtonProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={`h-8 w-8 p-0 ${className || ''}`}
    >
      <Edit className="h-4 w-4" />
      <span className="sr-only">Edit</span>
    </Button>
  );
}

interface DeleteActionButtonProps {
  onClick: () => void;
  className?: string;
}

export function DeleteActionButton({ onClick, className }: DeleteActionButtonProps) {
  return (
    <Button
      variant="ghost-destructive"
      size="sm"
      onClick={onClick}
      className={`h-8 w-8 p-0 ${className || ''}`}
    >
      <Trash2 className="h-4 w-4" />
      <span className="sr-only">Delete</span>
    </Button>
  );
}
