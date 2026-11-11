import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SshAuthPromptModal from './SshAuthPromptModal';
import { Provider } from './ui/provider';
import type { SshAuthPromptEvent } from '../types/ssh';

const prompt: SshAuthPromptEvent = {
  sessionId: 'ssh-test',
  name: 'MFA',
  instructions: 'Enter the code from your authenticator.',
  prompts: [
    { prompt: 'Verification code', echo: false },
    { prompt: 'Account', echo: true },
  ],
};

describe('SshAuthPromptModal', () => {
  it('renders server instructions and submits every response', () => {
    const onSubmit = vi.fn();
    render(
      <Provider>
        <SshAuthPromptModal prompt={prompt} onSubmit={onSubmit} onCancel={vi.fn()} />
      </Provider>,
    );

    expect(screen.getByText('Enter the code from your authenticator.')).toBeInTheDocument();
    expect(screen.getByLabelText('Verification code')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Account')).toHaveAttribute('type', 'text');

    fireEvent.change(screen.getByLabelText('Verification code'), {
      target: { value: '123456' },
    });
    fireEvent.change(screen.getByLabelText('Account'), { target: { value: 'root' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onSubmit).toHaveBeenCalledWith(['123456', 'root']);
  });

  it('cancels the pending prompt', () => {
    const onCancel = vi.fn();
    render(
      <Provider>
        <SshAuthPromptModal prompt={prompt} onSubmit={vi.fn()} onCancel={onCancel} />
      </Provider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
