import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import Modal from '../components/Modal';
import Button from '../components/Button';
import { useI18n } from '../i18n';

// App-styled replacement for window.confirm / window.prompt. `confirm` resolves
// to a boolean and `prompt` to the entered string or null (same contract as the
// native calls), so call sites only change `confirm(x)` → `await confirm(x)`.
// Alerts have no equivalent here on purpose — result notifications go to useToast.

export interface ConfirmOptions {
  message: string;
  title?: string;
  // Styles the confirm button as destructive and moves the initial focus to
  // Cancel, so a reflexive Enter cannot fire the destructive action.
  danger?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface PromptOptions {
  message: string;
  title?: string;
  placeholder?: string;
  initialValue?: string;
}

interface DialogContextValue {
  confirm: (options: string | ConfirmOptions) => Promise<boolean>;
  prompt: (options: string | PromptOptions) => Promise<string | null>;
}

type ActiveDialog =
  | { id: number; kind: 'confirm'; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { id: number; kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void };

const DialogContext = createContext<DialogContextValue | null>(null);

let dialogCounter = 0;

export function DialogProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveDialog | null>(null);
  // Mirror of `active` so opening a new dialog can settle the previous promise
  // without side effects inside a state updater (StrictMode-safe).
  const activeRef = useRef<ActiveDialog | null>(null);

  const open = useCallback((next: ActiveDialog) => {
    // ponytail: single slot — a new request cancels the previous dialog; add a queue if nesting ever matters.
    const previous = activeRef.current;
    if (previous) {
      if (previous.kind === 'confirm') previous.resolve(false);
      else previous.resolve(null);
    }
    activeRef.current = next;
    setActive(next);
  }, []);

  const close = useCallback(() => {
    activeRef.current = null;
    setActive(null);
  }, []);

  const confirm = useCallback((options: string | ConfirmOptions) => {
    const normalized = typeof options === 'string' ? { message: options } : options;
    return new Promise<boolean>((resolve) => {
      open({ id: ++dialogCounter, kind: 'confirm', options: normalized, resolve });
    });
  }, [open]);

  const prompt = useCallback((options: string | PromptOptions) => {
    const normalized = typeof options === 'string' ? { message: options } : options;
    return new Promise<string | null>((resolve) => {
      open({ id: ++dialogCounter, kind: 'prompt', options: normalized, resolve });
    });
  }, [open]);

  const value = useMemo(() => ({ confirm, prompt }), [confirm, prompt]);

  return (
    <DialogContext.Provider value={value}>
      {children}
      {active && <DialogHost key={active.id} dialog={active} onSettled={close} />}
    </DialogContext.Provider>
  );
}

function DialogHost({ dialog, onSettled }: { dialog: ActiveDialog; onSettled: () => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState(dialog.kind === 'prompt' ? dialog.options.initialValue ?? '' : '');

  const cancel = () => {
    if (dialog.kind === 'confirm') dialog.resolve(false);
    else dialog.resolve(null);
    onSettled();
  };

  const ok = () => {
    if (dialog.kind === 'confirm') dialog.resolve(true);
    else dialog.resolve(value);
    onSettled();
  };

  const danger = dialog.kind === 'confirm' && !!dialog.options.danger;
  const confirmLabel = (dialog.kind === 'confirm' && dialog.options.confirmLabel) || t('common.ok');
  const cancelLabel = (dialog.kind === 'confirm' && dialog.options.cancelLabel) || t('common.cancel');

  const footer = (
    <div className="mt-4 flex justify-end gap-2">
      <Button size="sm" onClick={cancel} autoFocus={danger}>{cancelLabel}</Button>
      <Button
        variant={danger ? 'danger' : 'primary'}
        size="sm"
        type={dialog.kind === 'prompt' ? 'submit' : 'button'}
        onClick={dialog.kind === 'prompt' ? undefined : ok}
        autoFocus={dialog.kind === 'confirm' && !danger}
      >
        {confirmLabel}
      </Button>
    </div>
  );

  return (
    <Modal open onClose={cancel} size="sm">
      <div className="bg-theme-card border border-theme-border rounded-2xl shadow-elevated p-5">
        {dialog.options.title && (
          <div className="text-sm font-semibold text-theme-text mb-2">{dialog.options.title}</div>
        )}
        <p className="text-sm text-theme-text-secondary whitespace-pre-line break-words">{dialog.options.message}</p>
        {dialog.kind === 'prompt' ? (
          <form onSubmit={(e) => { e.preventDefault(); ok(); }}>
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={dialog.options.placeholder}
              className="input-field mt-3"
            />
            {footer}
          </form>
        ) : (
          footer
        )}
      </div>
    </Modal>
  );
}

export function useDialog(): DialogContextValue {
  const value = useContext(DialogContext);
  if (!value) throw new Error('useDialog must be used within DialogProvider');
  return value;
}
