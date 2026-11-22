import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agentApi } from '@/entities/agent/api';
import { SupportChat } from './SupportChat';

vi.mock('@/entities/agent/api', () => ({
  agentApi: { step: vi.fn(), config: vi.fn() },
}));

describe('SupportChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(agentApi.config).mockResolvedValue({
      provider: 'gemini',
      providers: [
        { id: 'gemini', label: 'Gemini', vision: true },
        { id: 'deepseek', label: 'DeepSeek', vision: true },
      ],
      vision: true,
      audio: true,
    });
  });

  it('envía preguntas desde el Dashboard en modo soporte y muestra la guía', async () => {
    vi.mocked(agentApi.step).mockResolvedValue({
      estado: 'respuesta',
      texto: 'En Dashboard, usa Subir plano.',
      historial: [],
    });

    render(
      <MemoryRouter initialEntries={['/private/dashboard']}>
        <SupportChat />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Abrir ayuda del Agente Plasma3D' }));
    fireEvent.click(screen.getByRole('button', { name: '¿Cómo subo un plano?' }));

    await waitFor(() => {
      expect(agentApi.step).toHaveBeenCalledWith(expect.objectContaining({
        modo: 'soporte',
        mensaje: '¿Cómo subo un plano?',
        contexto: { pantalla: 'Dashboard', ruta: '/private/dashboard' },
      }));
    });
    expect(await screen.findByText('En Dashboard, usa Subir plano.')).toBeInTheDocument();
  });
});
