import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EMAIL_PREVIEW_TEMPLATES } from '~/features/admin/lib/email-preview-registry';
import { AdminEmailPreviewPage } from './AdminEmailPreviewPage';

describe('AdminEmailPreviewPage', () => {
  it('renders the subject, preview text, and iframe for the selected email', () => {
    render(
      <AdminEmailPreviewPage
        templates={EMAIL_PREVIEW_TEMPLATES}
        selectedTemplateId="reset-password"
        selectedScenarioId="standard"
        preview={{
          subject: 'Reset your Acme Workspace password',
          preview: 'Reset your password',
          html: '<html><body><h1>Reset Password</h1></body></html>',
          text: 'Reset Password',
        }}
        isLoading={false}
        onTemplateChange={vi.fn()}
        onScenarioChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Reset your Acme Workspace password')).toBeInTheDocument();
    expect(screen.getByText('Reset your password')).toBeInTheDocument();
    expect(screen.getByTestId('email-preview-frame')).toHaveAttribute(
      'srcdoc',
      '<html><body><h1>Reset Password</h1></body></html>',
    );
  });

  it('shows the selected template scenarios and updates the preview frame when props change', () => {
    const { rerender } = render(
      <AdminEmailPreviewPage
        templates={EMAIL_PREVIEW_TEMPLATES}
        selectedTemplateId="reset-password"
        selectedScenarioId="standard"
        preview={{
          subject: 'Reset your Acme Workspace password',
          preview: 'Reset your password',
          html: '<html><body><h1>Reset Password</h1></body></html>',
          text: 'Reset Password',
        }}
        isLoading={false}
        onTemplateChange={vi.fn()}
        onScenarioChange={vi.fn()}
      />,
    );

    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    expect(screen.getByText('Standard reset')).toBeInTheDocument();
    expect(
      screen.getByText('Default password reset request for an existing account.'),
    ).toBeInTheDocument();

    rerender(
      <AdminEmailPreviewPage
        templates={EMAIL_PREVIEW_TEMPLATES}
        selectedTemplateId="invitation"
        selectedScenarioId="member-invite"
        preview={{
          subject: 'Sam Ortiz invited you to join Success',
          preview: 'Accept your invitation',
          html: '<html><body><h1>Accept Invitation</h1></body></html>',
          text: 'Accept Invitation',
        }}
        isLoading={false}
        onTemplateChange={vi.fn()}
        onScenarioChange={vi.fn()}
      />,
    );

    const comboboxes = screen.getAllByRole('combobox');
    expect(within(comboboxes[0]).getByText('Organization Invitation')).toBeInTheDocument();
    expect(within(comboboxes[1]).getByText('Member invite')).toBeInTheDocument();
    expect(
      screen.getByText('A standard member invitation into a team workspace.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('email-preview-frame')).toHaveAttribute(
      'srcdoc',
      '<html><body><h1>Accept Invitation</h1></body></html>',
    );
  });
});
