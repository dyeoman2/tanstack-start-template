import { useForm } from '@tanstack/react-form';
import { Download, Pencil, Plus, Power, PowerOff, Sparkles } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '~/components/ui/field';
import { Input } from '~/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import type { ChatModelAccess } from '~/lib/shared/chat-models';

type ModelCatalogEntry = {
  modelId: string;
  label: string;
  description: string;
  access: ChatModelAccess;
  supportsWebSearch?: boolean;
  priceLabel?: string;
  contextWindow?: number;
  source: string;
  isActive: boolean;
  refreshedAt: number;
  beta?: boolean;
  deprecated?: boolean;
  deprecationDate?: string;
};

type ModelCatalogPayload = {
  modelId: string;
  label: string;
  description: string;
  access: ChatModelAccess;
  supportsWebSearch?: boolean;
  priceLabel?: string;
  contextWindow?: number;
  isActive: boolean;
  beta?: boolean;
  deprecated?: boolean;
  deprecationDate?: string;
};

interface ModelCatalogManagerProps {
  models: ModelCatalogEntry[] | undefined;
  isMutating: boolean;
  onCreateModel: (payload: ModelCatalogPayload) => Promise<unknown>;
  onUpdateModel: (args: {
    existingModelId: string;
    model: ModelCatalogPayload;
  }) => Promise<unknown>;
  onSetModelActiveState: (args: { modelId: string; isActive: boolean }) => Promise<unknown>;
  onImportTopFreeModels: () => Promise<unknown>;
  onImportTopPaidModels: () => Promise<unknown>;
}

const EMPTY_FORM_VALUES: ModelCatalogPayload = {
  modelId: '',
  label: '',
  description: '',
  access: 'public',
  supportsWebSearch: true,
  priceLabel: '',
  contextWindow: undefined,
  isActive: true,
  beta: false,
  deprecated: false,
  deprecationDate: '',
};

export function ModelCatalogManager({
  models,
  isMutating,
  onCreateModel,
  onUpdateModel,
  onSetModelActiveState,
  onImportTopFreeModels,
  onImportTopPaidModels,
}: ModelCatalogManagerProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<ModelCatalogEntry | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const modelIdId = useId();
  const labelId = useId();
  const descriptionId = useId();
  const accessId = useId();
  const priceLabelId = useId();
  const contextWindowId = useId();
  const isEditing = editingModel !== null;

  const initialValues = useMemo<ModelCatalogPayload>(() => {
    if (!editingModel) {
      return EMPTY_FORM_VALUES;
    }

    return {
      modelId: editingModel.modelId,
      label: editingModel.label,
      description: editingModel.description,
      access: editingModel.access,
      supportsWebSearch: editingModel.supportsWebSearch ?? true,
      priceLabel: editingModel.priceLabel ?? '',
      contextWindow: editingModel.contextWindow,
      isActive: editingModel.isActive,
      beta: editingModel.beta ?? false,
      deprecated: editingModel.deprecated ?? false,
      deprecationDate: editingModel.deprecationDate ?? '',
    };
  }, [editingModel]);

  const form = useForm({
    defaultValues: initialValues,
    onSubmit: async ({ value }) => {
      setSubmitError(null);

      const payload: ModelCatalogPayload = {
        modelId: value.modelId.trim(),
        label: value.label.trim(),
        description: value.description.trim(),
        access: value.access,
        supportsWebSearch: value.supportsWebSearch ?? true,
        priceLabel: emptyStringToUndefined(value.priceLabel),
        contextWindow: value.contextWindow,
        isActive: value.isActive,
        beta: value.beta,
        deprecated: value.deprecated,
        deprecationDate: emptyStringToUndefined(value.deprecationDate),
      };

      try {
        if (editingModel) {
          await onUpdateModel({
            existingModelId: editingModel.modelId,
            model: payload,
          });
        } else {
          await onCreateModel(payload);
        }

        setDialogOpen(false);
      } catch (error) {
        setSubmitError(error instanceof Error ? error.message : 'Failed to save AI model');
      }
    },
  });

  useEffect(() => {
    form.reset(initialValues);
    setSubmitError(null);
  }, [form, initialValues]);

  const openCreateDialog = () => {
    setEditingModel(null);
    setDialogOpen(true);
  };

  const openEditDialog = (model: ModelCatalogEntry) => {
    setEditingModel(model);
    setDialogOpen(true);
  };

  const activeModels = models?.filter((model) => model.isActive) ?? [];

  return (
    <section className="space-y-4 rounded-3xl border border-border/70 bg-card/70 p-6 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 text-sm font-medium text-primary">
            <Sparkles className="size-4" />
            OpenRouter model catalog
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">Curated AI model management</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Add the OpenRouter models your workspace supports, control whether they are public or
            admin-only, and deactivate entries without losing their history.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={isMutating}
            onClick={() => void onImportTopFreeModels()}
          >
            <Download className="size-4" />
            Import top free models
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={isMutating}
            onClick={() => void onImportTopPaidModels()}
          >
            <Download className="size-4" />
            Import top paid models
          </Button>
          <Button type="button" onClick={openCreateDialog}>
            <Plus className="size-4" />
            Add model
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatusCard label="Total models" value={models?.length ?? 0} />
        <StatusCard label="Active models" value={activeModels.length} />
        <StatusCard
          label="Admin-only models"
          value={activeModels.filter((model) => model.access === 'admin').length}
        />
      </div>

      {models && models.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead>Access</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="w-[180px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {models.map((model) => (
              <TableRow key={model.modelId}>
                <TableCell className="align-top">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{model.label}</span>
                      {model.supportsWebSearch ? <Badge variant="info">Web</Badge> : null}
                      {model.beta ? <Badge variant="warning">Beta</Badge> : null}
                      {model.deprecated ? <Badge variant="outline">Deprecated</Badge> : null}
                    </div>
                    <p className="text-sm text-muted-foreground">{model.description}</p>
                    <p className="font-mono text-xs text-muted-foreground">{model.modelId}</p>
                    {model.priceLabel ? (
                      <p className="text-xs text-muted-foreground">{model.priceLabel}</p>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={model.access === 'public' ? 'secondary' : 'info'}>
                    {model.access === 'public' ? 'Public' : 'Admin only'}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={model.isActive ? 'success' : 'outline'}>
                    {model.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatTimestamp(model.refreshedAt)}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openEditDialog(model)}
                    >
                      <Pencil className="size-4" />
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isMutating}
                      onClick={() =>
                        void onSetModelActiveState({
                          modelId: model.modelId,
                          isActive: !model.isActive,
                        })
                      }
                    >
                      {model.isActive ? (
                        <>
                          <PowerOff className="size-4" />
                          Deactivate
                        </>
                      ) : (
                        <>
                          <Power className="size-4" />
                          Activate
                        </>
                      )}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <Alert variant="info">
          <Sparkles className="h-4 w-4" />
          <AlertTitle>No curated models yet</AlertTitle>
          <AlertDescription>
            Add your first OpenRouter model to make it selectable in the chat workspace.
          </AlertDescription>
        </Alert>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit AI model' : 'Add AI model'}</DialogTitle>
            <DialogDescription>
              Curate the OpenRouter models available to your chat users.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit();
            }}
            className="space-y-4"
          >
            <div className="grid gap-4 md:grid-cols-2">
              <form.Field
                name="modelId"
                validators={{
                  onChange: ({ value }) => (!value.trim() ? 'Model ID is required' : undefined),
                }}
              >
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={modelIdId}>Model ID</FieldLabel>
                    <Input
                      id={modelIdId}
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                      onBlur={field.handleBlur}
                      placeholder="openai/gpt-4o-mini"
                    />
                    <FieldDescription>Use the exact OpenRouter model id.</FieldDescription>
                    <FieldError>{field.state.meta.errors[0]}</FieldError>
                  </Field>
                )}
              </form.Field>

              <form.Field
                name="label"
                validators={{
                  onChange: ({ value }) => (!value.trim() ? 'Label is required' : undefined),
                }}
              >
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={labelId}>Label</FieldLabel>
                    <Input
                      id={labelId}
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                      onBlur={field.handleBlur}
                      placeholder="GPT-4o Mini"
                    />
                    <FieldError>{field.state.meta.errors[0]}</FieldError>
                  </Field>
                )}
              </form.Field>
            </div>

            <form.Field
              name="description"
              validators={{
                onChange: ({ value }) => (!value.trim() ? 'Description is required' : undefined),
              }}
            >
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={descriptionId}>Description</FieldLabel>
                  <Input
                    id={descriptionId}
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                    placeholder="Fast, affordable assistant model for general-purpose chat."
                  />
                  <FieldError>{field.state.meta.errors[0]}</FieldError>
                </Field>
              )}
            </form.Field>

            <div className="grid gap-4 md:grid-cols-3">
              <form.Field name="access">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={accessId}>Access</FieldLabel>
                    <Select
                      value={field.state.value}
                      onValueChange={(value: ChatModelAccess) => field.handleChange(value)}
                    >
                      <SelectTrigger id={accessId}>
                        <SelectValue placeholder="Select access" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="public">Public</SelectItem>
                        <SelectItem value="admin">Admin only</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              </form.Field>

              <form.Field name="priceLabel">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={priceLabelId}>Price label</FieldLabel>
                    <Input
                      id={priceLabelId}
                      value={field.state.value ?? ''}
                      onChange={(event) => field.handleChange(event.target.value)}
                      onBlur={field.handleBlur}
                      placeholder="$0.15/M input"
                    />
                  </Field>
                )}
              </form.Field>

              <form.Field
                name="contextWindow"
                validators={{
                  onChange: ({ value }) =>
                    value !== undefined && value <= 0
                      ? 'Context window must be positive'
                      : undefined,
                }}
              >
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={contextWindowId}>Context window</FieldLabel>
                    <Input
                      id={contextWindowId}
                      type="number"
                      min={1}
                      value={field.state.value ?? ''}
                      onChange={(event) =>
                        field.handleChange(
                          event.target.value ? Number(event.target.value) : undefined,
                        )
                      }
                      onBlur={field.handleBlur}
                      placeholder="128000"
                    />
                    <FieldError>{field.state.meta.errors[0]}</FieldError>
                  </Field>
                )}
              </form.Field>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <form.Field name="supportsWebSearch">
                {(field) => (
                  <Field>
                    <FieldLabel>Web search</FieldLabel>
                    <Select
                      value={field.state.value ? 'true' : 'false'}
                      onValueChange={(value) => field.handleChange(value === 'true')}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">Enabled</SelectItem>
                        <SelectItem value="false">Disabled</SelectItem>
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      Enable OpenRouter web search for this model.
                    </FieldDescription>
                  </Field>
                )}
              </form.Field>

              <form.Field name="isActive">
                {(field) => (
                  <Field>
                    <FieldLabel>Active</FieldLabel>
                    <Select
                      value={field.state.value ? 'true' : 'false'}
                      onValueChange={(value) => field.handleChange(value === 'true')}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">Yes</SelectItem>
                        <SelectItem value="false">No</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              </form.Field>

              <form.Field name="beta">
                {(field) => (
                  <Field>
                    <FieldLabel>Beta badge</FieldLabel>
                    <Select
                      value={field.state.value ? 'true' : 'false'}
                      onValueChange={(value) => field.handleChange(value === 'true')}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">Yes</SelectItem>
                        <SelectItem value="false">No</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              </form.Field>

              <form.Field name="deprecated">
                {(field) => (
                  <Field>
                    <FieldLabel>Deprecated</FieldLabel>
                    <Select
                      value={field.state.value ? 'true' : 'false'}
                      onValueChange={(value) => field.handleChange(value === 'true')}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">Yes</SelectItem>
                        <SelectItem value="false">No</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              </form.Field>
            </div>

            <form.Field name="deprecationDate">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={`${modelIdId}-deprecation`}>Deprecation date</FieldLabel>
                  <Input
                    id={`${modelIdId}-deprecation`}
                    value={field.state.value ?? ''}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                    placeholder="2026-12-31"
                  />
                  <FieldDescription>
                    Optional ISO date string for planned retirement.
                  </FieldDescription>
                </Field>
              )}
            </form.Field>

            {submitError ? (
              <Alert variant="destructive">
                <Sparkles className="h-4 w-4" />
                <AlertTitle>Save failed</AlertTitle>
                <AlertDescription>{submitError}</AlertDescription>
              </Alert>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <form.Subscribe selector={(state) => [state.canSubmit]}>
                {([canSubmit]) => (
                  <Button type="submit" disabled={!canSubmit || isMutating}>
                    {isMutating ? 'Saving...' : isEditing ? 'Save changes' : 'Add model'}
                  </Button>
                )}
              </form.Subscribe>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function StatusCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function emptyStringToUndefined(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function formatTimestamp(value: number) {
  return new Date(value).toLocaleString();
}
