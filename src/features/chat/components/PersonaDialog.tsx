import { MessageSquarePlus, Pencil, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Input } from '~/components/ui/input';
import { Textarea } from '~/components/ui/textarea';
import type { ChatPersona } from '~/features/chat/types';

type PersonaDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  personas: ChatPersona[];
  selectedPersonaId?: string;
  onSelectPersona: (personaId?: string) => void;
  onCreatePersona: (values: { name: string; prompt: string }) => Promise<void>;
  onUpdatePersona: (values: { personaId: string; name: string; prompt: string }) => Promise<void>;
  onDeletePersona: (personaId: string) => Promise<void>;
};

export function PersonaDialog({
  open,
  onOpenChange,
  personas,
  selectedPersonaId,
  onSelectPersona,
  onCreatePersona,
  onUpdatePersona,
  onDeletePersona,
}: PersonaDialogProps) {
  const [search, setSearch] = useState('');
  const [editingPersonaId, setEditingPersonaId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) {
      return personas;
    }

    return personas.filter(
      (persona) =>
        persona.name.toLowerCase().includes(keyword) ||
        persona.prompt.toLowerCase().includes(keyword),
    );
  }, [personas, search]);

  const startCreate = () => {
    setEditingPersonaId(null);
    setName('');
    setPrompt('');
  };

  const startEdit = (persona: ChatPersona) => {
    setEditingPersonaId(persona._id);
    setName(persona.name);
    setPrompt(persona.prompt);
  };

  const handleSubmit = async () => {
    if (editingPersonaId) {
      await onUpdatePersona({ personaId: editingPersonaId, name, prompt });
    } else {
      await onCreatePersona({ name, prompt });
    }

    startCreate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl rounded-2xl">
        <DialogHeader>
          <DialogTitle>Persona Library</DialogTitle>
          <DialogDescription>
            Choose a conversation style or create a custom persona.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 md:grid-cols-[1.1fr_1.4fr]">
          <div className="space-y-4">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search personas"
            />
            <div className="h-[420px] space-y-3 overflow-y-auto rounded-xl border border-border/60 p-3">
              <button
                type="button"
                onClick={() => onSelectPersona(undefined)}
                className={`w-full rounded-xl border px-4 py-3 text-left ${
                  !selectedPersonaId
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-border/60 hover:bg-accent/30'
                }`}
              >
                <p className="font-medium">Default</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  You are an AI assistant that helps people find information.
                </p>
              </button>
              {filtered.map((persona) => (
                <div
                  key={persona._id}
                  className={`rounded-xl border px-4 py-3 ${
                    selectedPersonaId === persona._id
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-border/60'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectPersona(persona._id)}
                    className="w-full text-left"
                  >
                    <p className="font-medium">{persona.name}</p>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {persona.prompt}
                    </p>
                  </button>
                  <div className="mt-3 flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => startEdit(persona)}>
                      <Pencil className="size-3.5" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive"
                      onClick={() => {
                        void onDeletePersona(persona._id);
                      }}
                    >
                      <Trash2 className="size-3.5" />
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-4 rounded-xl border border-border/60 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium">
                  {editingPersonaId ? 'Edit Persona' : 'Create Persona'}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {editingPersonaId ? 'Update this custom persona.' : 'Add a custom persona.'}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={startCreate}>
                Reset
              </Button>
            </div>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name"
            />
            <Textarea
              rows={12}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Prompt"
            />
            <div className="flex items-center gap-2">
              <Button
                onClick={() => {
                  void handleSubmit();
                }}
                disabled={!name.trim() || !prompt.trim()}
              >
                <MessageSquarePlus className="size-4" />
                {editingPersonaId ? 'Save Persona' : 'Create Persona'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
