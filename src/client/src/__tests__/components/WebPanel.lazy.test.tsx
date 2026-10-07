import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WebPanel from '../../components/WebPanel';
import { I18nProvider } from '../../i18n';

// WebPanel reads `'electronAPI' in window` at module load, so it must exist
// before the import above runs.
vi.hoisted(() => { (window as unknown as { electronAPI: object }).electronAPI = {}; });

const webviews = () => document.querySelectorAll('webview').length;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('clitrigger-lang', 'en');
  localStorage.setItem('webPanelTabs', JSON.stringify({
    tabs: [
      { id: 'a', url: 'https://a.example' },
      { id: 'b', url: 'https://b.example' },
      { id: 'c', url: 'https://c.example' },
    ],
    activeId: 'a',
  }));
});

describe('WebPanel lazy guests', () => {
  it('creates no <webview> while hidden, then only the tabs that have been active while visible', () => {
    const { rerender } = render(<I18nProvider><WebPanel visible={false} /></I18nProvider>);
    expect(webviews()).toBe(0);

    rerender(<I18nProvider><WebPanel visible /></I18nProvider>);
    expect(webviews()).toBe(1);

    fireEvent.click(screen.getAllByRole('tab')[1]);
    expect(webviews()).toBe(2);

    // Hiding again keeps the already-created guests mounted (no reload on return).
    rerender(<I18nProvider><WebPanel visible={false} /></I18nProvider>);
    expect(webviews()).toBe(2);
  });
});
