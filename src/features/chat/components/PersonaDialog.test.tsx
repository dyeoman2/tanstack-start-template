import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PersonaDialog } from '~/features/chat/components/PersonaDialog';

describe('PersonaDialog', () => {
  it('only shows management controls for personas the viewer can manage', async () => {
    const user = userEvent.setup();
    const onDeletePersona = vi.fn().mockResolvedValue(undefined);

    render(
      <PersonaDialog
        open
        onOpenChange={vi.fn()}
        personas={[
          {
            _id: 'persona-owned' as never,
            name: 'Owned Persona',
            prompt: 'Owned prompt',
            createdAt: 1,
            updatedAt: 1,
            canManage: true,
          },
          {
            _id: 'persona-shared' as never,
            name: 'Shared Persona',
            prompt: 'Shared prompt',
            createdAt: 1,
            updatedAt: 1,
            canManage: false,
          },
        ]}
        selectedPersonaId={undefined}
        onSelectPersona={vi.fn()}
        onCreatePersona={vi.fn().mockResolvedValue(undefined)}
        onUpdatePersona={vi.fn().mockResolvedValue(undefined)}
        onDeletePersona={onDeletePersona}
      />,
    );

    expect(screen.getByText('Owned Persona')).toBeInTheDocument();
    expect(screen.getByText('Shared Persona')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /delete/i }));
    expect(onDeletePersona).toHaveBeenCalledWith('persona-owned');

    expect(screen.queryAllByRole('button', { name: /edit/i })).toHaveLength(1);
    expect(screen.queryAllByRole('button', { name: /delete/i })).toHaveLength(1);
  });
});
