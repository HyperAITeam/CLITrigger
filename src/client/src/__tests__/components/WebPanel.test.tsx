import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import WebPanel from '../../components/WebPanel';
import { I18nProvider } from '../../i18n';

const renderPanel = () => render(<I18nProvider><WebPanel /></I18nProvider>);
const tabs = () => screen.getAllByRole('tab');
const closeButton = (tab: HTMLElement) => within(tab).getByRole('button', { name: 'Close tab' });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('clitrigger-lang', 'en');
});

describe('WebPanel tabs', () => {
  it('opens a blank tab with + and focuses the address bar', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'New tab' }));
    expect(tabs()).toHaveLength(2);
    expect(tabs()[1]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('textbox')).toHaveFocus();
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('closing the active tab activates its neighbour; closing the last one leaves a blank tab', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'New tab' }));
    fireEvent.click(closeButton(tabs()[1]));
    expect(tabs()).toHaveLength(1);
    expect(tabs()[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('textbox')).toHaveValue('https://www.notion.so');

    fireEvent.click(closeButton(tabs()[0]));
    expect(tabs()).toHaveLength(1);
    expect(screen.getByRole('textbox')).toHaveValue('');
  });
});
