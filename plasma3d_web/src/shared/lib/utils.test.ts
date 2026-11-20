import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('une clases', () => {
    expect(cn('px-2', 'text-sm')).toBe('px-2 text-sm');
  });

  it('resuelve conflictos de Tailwind', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });

  it('ignora valores falsy', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b');
  });
});
