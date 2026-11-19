import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './button';

describe('Button', () => {
  it('renderiza el texto y dispara onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Guardar</Button>);

    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('aplica la variante y las clases personalizadas', () => {
    render(
      <Button variant="destructive" className="custom-class">
        Eliminar
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Eliminar' });

    expect(button).toHaveClass('custom-class');
    expect(button.className).toContain('bg-danger');
  });

  it('no dispara onClick cuando está deshabilitado', () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Deshabilitado
      </Button>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Deshabilitado' }));

    expect(onClick).not.toHaveBeenCalled();
  });
});
