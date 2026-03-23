import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { Spinner } from '~/components/ui/spinner';
import {
  type EmailPreviewTemplateDefinition,
  type EmailTemplateId,
  getEmailPreviewTemplate,
  isEmailTemplateId,
} from '~/features/admin/lib/email-preview-registry';
import type { EmailPreviewResponse } from '~/features/admin/server/email-previews';

type AdminEmailPreviewPageProps = {
  templates: readonly EmailPreviewTemplateDefinition[];
  selectedTemplateId: EmailTemplateId;
  selectedScenarioId: string;
  preview: EmailPreviewResponse | null;
  isLoading: boolean;
  onTemplateChange: (templateId: EmailTemplateId) => void;
  onScenarioChange: (scenarioId: string) => void;
};

export function AdminEmailPreviewPage({
  templates,
  selectedTemplateId,
  selectedScenarioId,
  preview,
  isLoading,
  onTemplateChange,
  onScenarioChange,
}: AdminEmailPreviewPageProps) {
  const fallbackTemplate = templates[0];
  if (!fallbackTemplate) {
    return null;
  }

  const selectedTemplate = getEmailPreviewTemplate(selectedTemplateId) ?? fallbackTemplate;
  const selectedScenario =
    selectedTemplate.scenarios.find((scenario) => scenario.id === selectedScenarioId) ??
    selectedTemplate.scenarios[0];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Preview Controls</CardTitle>
          <CardDescription>
            Select a template and sample scenario to preview the final rendered email HTML.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Template</p>
            <Select
              value={selectedTemplate.id}
              onValueChange={(value) => {
                if (isEmailTemplateId(value)) {
                  onTemplateChange(value);
                }
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a template" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">{selectedTemplate.description}</p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Scenario</p>
            <Select value={selectedScenario.id} onValueChange={onScenarioChange}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a scenario" />
              </SelectTrigger>
              <SelectContent>
                {selectedTemplate.scenarios.map((scenario) => (
                  <SelectItem key={scenario.id} value={scenario.id}>
                    {scenario.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">{selectedScenario.description}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Email Preview</CardTitle>
          <CardDescription>
            This preview uses the same rendered HTML and plain-text source as production sends.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Subject
              </p>
              {preview?.subject ? (
                <p className="text-sm text-foreground">{preview.subject}</p>
              ) : (
                <PreviewFieldSpinner label="Loading subject" />
              )}
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Preview text
              </p>
              {preview?.preview ? (
                <p className="text-sm text-foreground">{preview.preview}</p>
              ) : (
                <PreviewFieldSpinner label="Loading preview text" />
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border bg-slate-100">
            {isLoading || !preview ? (
              <div className="flex h-[840px] items-center justify-center">
                <Spinner className="size-8" />
              </div>
            ) : (
              <iframe
                title={`${selectedTemplate.label} email preview`}
                data-testid="email-preview-frame"
                srcDoc={preview.html}
                sandbox=""
                className="h-[840px] w-full bg-white"
              />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PreviewFieldSpinner({ label }: { label: string }) {
  return (
    <div className="flex min-h-5 items-center">
      <Spinner className="size-4" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
