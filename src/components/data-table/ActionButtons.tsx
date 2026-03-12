import { Edit, LogIn, Trash2 } from 'lucide-react';
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

interface ImpersonateActionButtonProps {
  onClick: () => void;
  className?: string;
  disabled?: boolean;
}

export function ImpersonateActionButton({
  onClick,
  className,
  disabled = false,
}: ImpersonateActionButtonProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className={`h-8 w-8 p-0 ${className || ''}`}
      title="Impersonate user"
    >
      <LogIn className="h-4 w-4" />
      <span className="sr-only">Impersonate</span>
    </Button>
  );
}
