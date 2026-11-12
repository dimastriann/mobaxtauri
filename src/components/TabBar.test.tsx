import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TabBar from './TabBar';
import { Provider } from './ui/provider';
import { useSessionStore } from '../store/useSessionStore';

describe('TabBar accessibility', () => {
  beforeEach(() => {
    useSessionStore.setState({
      sessions: [
        {
          id: 'ssh-prod',
          name: 'Production',
          type: 'ssh',
          status: 'connected',
          host: 'prod.example',
          user: 'root',
        },
        {
          id: 'ssh-prod::1',
          configId: 'ssh-prod',
          name: 'Production',
          type: 'ssh',
          status: 'connected',
          host: 'prod.example',
          user: 'root',
          ephemeral: true,
        },
      ],
      openTabs: ['ssh-prod', 'ssh-prod::1'],
      activeSessionId: 'ssh-prod',
    });
  });

  it('offers pane layout choices and disables four-pane mode with too few tabs', () => {
    const onSetPaneLayout = vi.fn();
    render(
      <Provider>
        <TabBar
          onNewSession={vi.fn()}
          paneCount={1}
          paneLayout="columns"
          broadcastInput={false}
          onSetPaneLayout={onSetPaneLayout}
          onToggleBroadcast={vi.fn()}
          onActivateSession={vi.fn()}
        />
      </Provider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Split panes side by side' }));
    expect(onSetPaneLayout).toHaveBeenCalledWith('columns');
    expect(screen.getByRole('button', { name: 'Four-pane grid' })).toBeDisabled();
  });

  it('exposes a tablist with selected tabs and arrow navigation', () => {
    const onActivateSession = vi.fn();
    render(
      <Provider>
        <TabBar
          onNewSession={vi.fn()}
          paneCount={1}
          paneLayout="columns"
          broadcastInput={false}
          onSetPaneLayout={vi.fn()}
          onToggleBroadcast={vi.fn()}
          onActivateSession={onActivateSession}
        />
      </Provider>,
    );

    expect(screen.getByRole('tablist', { name: 'Session tabs' })).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');

    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(onActivateSession).toHaveBeenCalledWith('ssh-prod::1');
  });
});
