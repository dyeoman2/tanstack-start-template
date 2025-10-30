import { AlertTriangle, Upload } from 'lucide-react';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Button } from '~/components/ui/button';

interface DocumentWithReview {
  id: string;
  originalFilename: string;
  review?: {
    issues?: string[] | null;
    aiProvider?: string | null;
  } | null;
}

interface DocumentReviewFeedbackProps {
  documents: DocumentWithReview[];
  onUploadReplacement: () => void;
  onOverrideApprove: (doc: { id: string; filename: string }) => void;
  overrideMutation: {
    isPending: boolean;
  };
}

/**
 * Shared component for displaying AI document review feedback and actions.
 * Used by both checklist items and agent authorization forms.
 */
export function DocumentReviewFeedback({
  documents,
  onUploadReplacement,
  onOverrideApprove,
  overrideMutation,
}: DocumentReviewFeedbackProps) {
  const hasIssues = documents.some(
    (doc) =>
      (doc.review?.issues && doc.review.issues.length > 0) ||
      doc.review?.aiProvider === 'manual_override',
  );

  const canOverride = documents.some(
    (doc) =>
      doc.review?.issues &&
      doc.review.issues.length > 0 &&
      doc.review?.aiProvider !== 'manual_override',
  );

  if (!hasIssues) return null;

  return (
    <Alert variant="warning" className="space-y-3">
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription className="space-y-2 sm:space-y-3 text-sm sm:text-base">
        <p className="mb-2 font-medium">Please address the following and resubmit:</p>
        {documents.map((doc) => {
          // Show issues if they exist, regardless of approval status
          if (!doc.review?.issues || doc.review.issues.length === 0) return null;
          return (
            <div key={doc.id} className="space-y-2">
              <ul className="ml-2 list-disc space-y-1">
                {doc.review.issues.map((issue) => (
                  <li key={issue} className="text-sm leading-snug">
                    {issue}
                  </li>
                ))}
              </ul>
              {doc.review.aiProvider === 'manual_override' && (
                <p className="text-xs italic text-primary sm:text-sm">
                  ⚠️ These issues were overridden by the user.
                </p>
              )}
            </div>
          );
        })}
        <div className="flex w-full flex-col gap-2 sm:flex-row">
          <Button
            size="sm"
            variant="default"
            onClick={onUploadReplacement}
            className="w-full justify-center sm:flex-1 sm:justify-center sm:w-auto gap-2"
          >
            <Upload className="h-4 w-4" />
            <span>Upload Replacement</span>
          </Button>
          {canOverride ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                // Find the document with issues to override
                const docWithIssues = documents.find(
                  (doc) =>
                    doc.review?.issues &&
                    doc.review.issues.length > 0 &&
                    doc.review?.aiProvider !== 'manual_override',
                );
                if (docWithIssues) {
                  onOverrideApprove({
                    id: docWithIssues.id,
                    filename: docWithIssues.originalFilename,
                  });
                }
              }}
              className="w-full justify-center sm:flex-1 sm:justify-center sm:w-auto"
              disabled={overrideMutation.isPending}
            >
              <span>Override warning</span>
            </Button>
          ) : null}
        </div>
      </AlertDescription>
    </Alert>
  );
}
