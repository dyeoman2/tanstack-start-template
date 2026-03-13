import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EMAIL_PREVIEW_SCENARIO_ID,
  DEFAULT_EMAIL_PREVIEW_TEMPLATE_ID,
  getEmailPreviewScenario,
  resolveEmailPreviewSelection,
} from './email-preview-registry';

describe('resolveEmailPreviewSelection', () => {
  it('falls back to the default template and scenario when search params are missing', () => {
    expect(resolveEmailPreviewSelection({})).toEqual({
      template: DEFAULT_EMAIL_PREVIEW_TEMPLATE_ID,
      scenario: DEFAULT_EMAIL_PREVIEW_SCENARIO_ID,
    });
  });

  it('keeps a valid template but resets an invalid scenario to that template default', () => {
    expect(
      resolveEmailPreviewSelection({
        template: 'invitation',
        scenario: 'not-a-real-scenario',
      }),
    ).toEqual({
      template: 'invitation',
      scenario: 'admin-invite',
    });
  });
});

describe('getEmailPreviewScenario', () => {
  it('returns null when the scenario does not belong to the selected template', () => {
    expect(getEmailPreviewScenario('reset-password', 'admin-invite')).toBeNull();
  });
});
