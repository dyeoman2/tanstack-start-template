import { Database, Trash2 } from 'lucide-react';
import { DeleteConfirmationDialog } from '~/components/ui/delete-confirmation-dialog';

interface TruncateDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isTruncating: boolean;
}

export function TruncateDataModal({
  isOpen,
  onClose,
  onConfirm,
  isTruncating,
}: TruncateDataModalProps) {
  const handleClose = () => {
    onClose();
  };

  const handleConfirm = () => {
    onConfirm();
  };

  return (
    <DeleteConfirmationDialog
      open={isOpen}
      onClose={handleClose}
      title="Danger Zone"
      description="This will permanently delete ALL data except for users and system data."
      confirmationPhrase="TRUNCATE_ALL_DATA"
      confirmationPlaceholder="TRUNCATE_ALL_DATA"
      deleteText={
        <>
          <Trash2 className="h-4 w-4 mr-2" />
          Truncate All Data
        </>
      }
      cancelText="Cancel"
      isDeleting={isTruncating}
      onConfirm={handleConfirm}
      variant="danger"
    >
      {isTruncating && (
        <div className="flex items-center text-sm text-muted-foreground">
          <Database className="h-4 w-4 mr-2 animate-spin" />
          Processing truncation...
        </div>
      )}
    </DeleteConfirmationDialog>
  );
}
