import { AlertTriangle, Database, Trash2 } from 'lucide-react';
import { useId } from 'react';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';

interface TruncateDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  confirmText: string;
  onConfirmTextChange: (value: string) => void;
  onConfirm: () => void;
  isTruncating: boolean;
}

export function TruncateDataModal({
  isOpen,
  onClose,
  confirmText,
  onConfirmTextChange,
  onConfirm,
  isTruncating,
}: TruncateDataModalProps) {
  const confirmTextId = useId();

  if (!isOpen) return null;

  const handleClose = () => {
    onClose();
    onConfirmTextChange('');
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-20 mx-auto p-5 border w-full max-w-md shadow-lg rounded-md bg-white">
        <div className="mt-3">
          <div className="flex items-center mb-4">
            <AlertTriangle className="h-6 w-6 text-red-500 mr-3" />
            <h3 className="text-lg font-medium text-gray-900">Danger Zone</h3>
          </div>

          <div className="mb-4">
            <p className="text-sm text-gray-600 mb-4">
              This will permanently delete ALL except for users and system data.
            </p>
          </div>

          <div className="mb-4">
            <Label htmlFor={confirmTextId} className="text-sm font-medium text-gray-700">
              Type{' '}
              <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">TRUNCATE_ALL_DATA</code> to
              confirm:
            </Label>
            <Input
              id={confirmTextId}
              type="text"
              value={confirmText}
              onChange={(e) => onConfirmTextChange(e.target.value)}
              placeholder="TRUNCATE_ALL_DATA"
              className="mt-1"
            />
          </div>

          <div className="flex justify-end space-x-3">
            <Button variant="outline" onClick={handleClose} disabled={isTruncating}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={onConfirm}
              disabled={isTruncating || confirmText !== 'TRUNCATE_ALL_DATA'}
            >
              {isTruncating ? (
                <>
                  <Database className="h-4 w-4 mr-2 animate-spin" />
                  Truncating...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Truncate All Data
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
