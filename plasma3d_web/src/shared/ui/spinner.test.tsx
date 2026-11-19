import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FullPageSpinner, Skeleton, Spinner } from './spinner';

describe('Spinner', () => {
  it('muestra la etiqueta de carga', () => {
    render(<FullPageSpinner label="Cargando plano..." />);

    expect(screen.getByText('Cargando plano...')).toBeInTheDocument();
  });

  it('renderiza el skeleton con sus clases', () => {
    const { container } = render(<Skeleton className="h-4" />);

    expect(container.firstElementChild).toHaveClass('h-4');
  });

  it('renderiza el svg del spinner', () => {
    const { container } = render(<Spinner />);

    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
