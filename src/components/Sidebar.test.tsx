import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SidebarPanelTabs } from './Sidebar';
import { Provider } from './ui/provider';

describe('SidebarPanelTabs', () => {
  it('renders all four panels with accessible names', () => {
    render(
      <Provider>
        <SidebarPanelTabs active="sessions" onSelect={vi.fn()} showLabels />
      </Provider>,
    );

    expect(screen.getByRole('tablist', { name: 'Sidebar panels' })).toBeInTheDocument();
    for (const name of ['Sessions', 'SFTP', 'Snippets', 'Tunnels']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('tab', { name: 'Sessions' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Tunnels' })).toHaveAttribute('aria-selected', 'false');
  });

  it('selects the clicked panel', () => {
    const onSelect = vi.fn();
    render(
      <Provider>
        <SidebarPanelTabs active="sessions" onSelect={onSelect} showLabels />
      </Provider>,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Tunnels' }));
    expect(onSelect).toHaveBeenCalledWith('tunnels');
  });

  it('keeps accessible names when labels are hidden in a narrow sidebar', () => {
    render(
      <Provider>
        <SidebarPanelTabs active="sftp" onSelect={vi.fn()} showLabels={false} />
      </Provider>,
    );

    expect(screen.queryByText('Sessions')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Sessions' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'SFTP' })).toHaveAttribute('aria-selected', 'true');
  });
});
