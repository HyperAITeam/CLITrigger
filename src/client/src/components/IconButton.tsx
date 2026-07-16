import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../lib/cn';

type IconButtonSize = 'sm' | 'md' | 'lg';
type IconButtonVariant = 'default' | 'active' | 'danger';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: IconButtonSize;
  variant?: IconButtonVariant;
  pressed?: boolean;
}

const sizeClass: Record<IconButtonSize, string> = {
  sm: 'btn-icon-sm',
  md: 'btn-icon-md',
  lg: 'btn-icon-lg',
};

const variantClass: Record<IconButtonVariant, string> = {
  default: '',
  active: 'btn-icon-active',
  danger: 'btn-icon-danger',
};

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    size = 'md',
    variant = 'default',
    pressed,
    type = 'button',
    title,
    className,
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      title={title ?? label}
      className={cn('btn-icon', sizeClass[size], variantClass[variant], className)}
      {...props}
    />
  );
});

export default IconButton;
