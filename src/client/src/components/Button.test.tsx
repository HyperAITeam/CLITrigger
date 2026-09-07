import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Button from './Button';

describe('Button', () => {
  it('defaults to a safe button type and the base variant', () => {
    render(<Button>Save</Button>);

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('btn');
  });

  it('applies variant and size classes and merges className', () => {
    render(<Button variant="danger" size="sm" className="w-full">Delete</Button>);

    const button = screen.getByRole('button', { name: 'Delete' });
    expect(button).toHaveClass('btn-danger', 'btn-sm', 'w-full');
    expect(button).not.toHaveClass('btn');
  });

  it('keeps the variant padding when size is omitted', () => {
    render(<Button variant="primary">Run</Button>);

    const button = screen.getByRole('button', { name: 'Run' });
    expect(button).toHaveClass('btn-primary');
    expect(button).not.toHaveClass('btn-sm', 'btn-md', 'btn-lg');
  });

  it('honors an explicit submit type and forwards clicks', () => {
    const onClick = vi.fn();
    render(<Button type="submit" onClick={onClick}>Send</Button>);

    const button = screen.getByRole('button', { name: 'Send' });
    expect(button).toHaveAttribute('type', 'submit');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
