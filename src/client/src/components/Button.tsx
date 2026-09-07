import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../lib/cn';

type ButtonVariant = 'default' | 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  // Omitted size keeps the variant's own padding (the `.btn-primary` vs
  // `.btn-primary btn-sm` distinction used throughout the codebase).
  size?: ButtonSize;
}

const variantClass: Record<ButtonVariant, string> = {
  default: 'btn',
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  danger: 'btn-danger',
  ghost: 'btn-ghost',
};

const sizeClass: Record<ButtonSize, string> = {
  sm: 'btn-sm',
  md: 'btn-md',
  lg: 'btn-lg',
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size, type = 'button', className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(variantClass[variant], size && sizeClass[size], className)}
      {...props}
    />
  );
});

export default Button;
