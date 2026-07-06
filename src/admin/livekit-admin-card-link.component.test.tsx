// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import LivekitAdminCardLink from './livekit-admin-card-link.component';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

describe('LivekitAdminCardLink', () => {
  afterEach(() => {
    cleanup();
  });

  it('links to the LiveKit configuration page under the OpenMRS SPA base', () => {
    window.getOpenmrsSpaBase = () => '/openmrs/spa/';

    render(<LivekitAdminCardLink />);

    expect(screen.getByRole('link', { name: /manage voice consultation/i })).toHaveAttribute(
      'href',
      '/openmrs/spa/livekit-configuration',
    );
  });
});
