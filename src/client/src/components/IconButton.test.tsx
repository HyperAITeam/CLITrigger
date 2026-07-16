import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import IconButton from './IconButton';

describe('IconButton', () => {
  it('provides a safe button type and accessible label', () => {
    render(<IconButton label="Settings">icon</IconButton>);

    const button = screen.getByRole('button', { name: 'Settings' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('title', 'Settings');
    expect(button).toHaveClass('btn-icon', 'btn-icon-md');
  });

  it('exposes toggle state and preserves click behavior', () => {
    const onClick = vi.fn();
    render(
      <IconButton label="Stack mode" variant="active" pressed onClick={onClick}>
        icon
      </IconButton>,
    );

    const button = screen.getByRole('button', { name: 'Stack mode' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveClass('btn-icon-active');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
