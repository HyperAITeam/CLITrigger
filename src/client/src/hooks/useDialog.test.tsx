import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../i18n';
import { DialogProvider, useDialog } from './useDialog';

function Harness() {
  const { confirm, prompt } = useDialog();
  const [result, setResult] = useState('');
  return (
    <div>
      <button
        onClick={async () => {
          const ok = await confirm({ message: 'Sure?', confirmLabel: 'Yes', cancelLabel: 'No' });
          setResult(`confirm:${ok}`);
        }}
      >
        ask-confirm
      </button>
      <button
        onClick={async () => {
          const value = await prompt({ message: 'Name?', initialValue: 'draft' });
          setResult(`prompt:${JSON.stringify(value)}`);
        }}
      >
        ask-prompt
      </button>
      <output data-testid="result">{result}</output>
    </div>
  );
}

function setup() {
  return render(
    <I18nProvider>
      <DialogProvider>
        <Harness />
      </DialogProvider>
    </I18nProvider>,
  );
}

describe('useDialog', () => {
  it('resolves confirm with true when accepted', async () => {
    setup();
    fireEvent.click(screen.getByText('ask-confirm'));
    fireEvent.click(await screen.findByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('confirm:true'));
  });

  it('resolves confirm with false when cancelled', async () => {
    setup();
    fireEvent.click(screen.getByText('ask-confirm'));
    fireEvent.click(await screen.findByRole('button', { name: 'No' }));
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('confirm:false'));
  });

  it('resolves confirm with false on Escape', async () => {
    setup();
    fireEvent.click(screen.getByText('ask-confirm'));
    await screen.findByText('Sure?');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('confirm:false'));
  });

  it('resolves prompt with the entered value on submit', async () => {
    const { container } = setup();
    fireEvent.click(screen.getByText('ask-prompt'));
    const input = (await screen.findByDisplayValue('draft')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.click(container.ownerDocument.querySelector('button[type="submit"]')!);
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('prompt:"hello"'));
  });

  it('resolves prompt with null when dismissed', async () => {
    setup();
    fireEvent.click(screen.getByText('ask-prompt'));
    await screen.findByText('Name?');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('prompt:null'));
  });
});
