import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  position?: 'center' | 'top';
  animation?: 'scale' | 'slide-up';
  disableEscClose?: boolean;
  disableBackdropClose?: boolean;
  children: React.ReactNode;
}

const SIZE_CLASSES: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
};

const ANIMATION_CLASSES: Record<NonNullable<ModalProps['animation']>, string> = {
  scale: 'animate-scale-in',
  'slide-up': 'animate-slide-up',
};

export default function Modal({
  open,
  onClose,
  size = 'md',
  position = 'center',
  animation = 'scale',
  disableEscClose = false,
  disableBackdropClose = false,
  children,
}: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || disableEscClose) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, disableEscClose, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className={cn(
        'fixed inset-0 bg-black/50 backdrop-blur-sm z-modal flex',
        position === 'center' ? 'items-center justify-center p-4' : 'items-start justify-center px-4 pt-[20vh]',
      )}
      onClick={(e) => {
        if (!disableBackdropClose && e.target === overlayRef.current) onClose();
      }}
    >
      <div className={cn('w-full', SIZE_CLASSES[size], ANIMATION_CLASSES[animation])}>
        {children}
      </div>
    </div>,
    document.body
  );
}
