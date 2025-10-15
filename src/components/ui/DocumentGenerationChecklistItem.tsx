import { useMutation } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Spinner } from '~/components/ui/spinner';

interface DocumentGenerationChecklistItemProps {
  title: string;
  description?: string;
  downloadButtonText?: string;
  uploadInstruction?: string;
  onGenerate: () => Promise<{ pdfBase64: string; filename: string }>;
  instructions?: string[];
  additionalContent?: React.ReactNode;
}

export function DocumentGenerationChecklistItem({
  title: _title,
  description,
  downloadButtonText = 'Download Document',
  uploadInstruction = 'Upload the completed document using the button below.',
  onGenerate,
  instructions = ['Download the pre-filled document'],
  additionalContent,
}: DocumentGenerationChecklistItemProps) {
  const downloadMutation = useMutation({
    mutationFn: onGenerate,
    onSuccess: (result) => {
      const byteCharacters = atob(result.pdfBase64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/pdf' });

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    },
  });

  return (
    <>
      {description && <p className="text-sm text-muted-foreground mb-3">{description}</p>}

      <ol className="text-sm text-muted-foreground space-y-3 list-none">
        {[...instructions, uploadInstruction].map((instruction, index) => {
          const normalizedInstruction = instruction.trim();

          return (
            <li
              key={`instruction-${index}-${normalizedInstruction.slice(0, 20)}`}
              className="leading-6 flex items-start gap-3"
            >
              <span className="font-medium flex-none">{index + 1}.</span>
              <span className="whitespace-normal break-words min-w-0 flex-1">
                {normalizedInstruction}
              </span>
              {index === 0 ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => downloadMutation.mutate()}
                  disabled={downloadMutation.isPending}
                >
                  {downloadMutation.isPending ? (
                    <Spinner className="h-4 w-4 mr-2" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  {downloadButtonText}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ol>

      {additionalContent}
    </>
  );
}
