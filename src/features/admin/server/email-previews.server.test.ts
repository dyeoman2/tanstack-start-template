import { describe, expect, it } from 'vitest';
import { EMAIL_PREVIEW_TEMPLATES } from '~/features/admin/lib/email-preview-registry';
import { emailPreviewRequestSchema, renderEmailPreview } from './email-previews';

describe('renderEmailPreview', () => {
  it('renders every previewable template scenario with html, preview text, and plain text output', async () => {
    for (const template of EMAIL_PREVIEW_TEMPLATES) {
      for (const scenario of template.scenarios) {
        const result = await renderEmailPreview({
          template: template.id,
          scenario: scenario.id,
        });

        expect(result.subject.length).toBeGreaterThan(0);
        expect(result.preview.length).toBeGreaterThan(0);
        expect(result.html).toContain(result.subject);
        expect(result.html).toContain(result.preview);
        expect(result.text.length).toBeGreaterThan(0);
      }
    }
  });

  it('renders the selected preview template and returns html, text, subject, and preview text', async () => {
    const result = await renderEmailPreview({
      template: 'reset-password',
      scenario: 'standard',
    });

    expect(result.subject).toBe('Reset your Acme Workspace password');
    expect(result.preview).toBe('Reset your password');
    expect(result.html).toContain('Reset Password');
    expect(result.text).toContain('This password reset link will expire in 1 hour.');
  });

  it('rejects a scenario that does not belong to the selected template', async () => {
    await expect(
      renderEmailPreview({
        template: 'reset-password',
        scenario: 'admin-invite',
      }),
    ).rejects.toMatchObject({
      message: 'Unknown email preview scenario',
    });
  });
});

describe('emailPreviewRequestSchema', () => {
  it('rejects unknown template ids', () => {
    expect(() =>
      emailPreviewRequestSchema.parse({
        template: 'not-a-template',
        scenario: 'anything',
      }),
    ).toThrow();
  });
});
