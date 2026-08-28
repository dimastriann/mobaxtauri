import { beforeEach, describe, expect, it } from 'vitest';
import { Session, useSessionStore } from './useSessionStore';

const health: NonNullable<Session['health']> = {
  cpu: 10,
  ram: 20,
  ram_used: 200,
  ram_total: 1000,
  swap: 0,
  swap_used: 0,
  swap_total: 0,
  disk: 30,
};

describe('session health lifecycle', () => {
  beforeEach(() => {
    useSessionStore.setState({
      sessions: [
        {
          id: 'ssh-test',
          name: 'Test SSH',
          type: 'ssh',
          status: 'connected',
          health,
        },
      ],
      openTabs: ['ssh-test'],
      activeSessionId: 'ssh-test',
    });
  });

  it('clears health when a session disconnects', () => {
    useSessionStore.getState().updateSessionStatus('ssh-test', 'disconnected');
    expect(useSessionStore.getState().sessions[0].health).toBeUndefined();
  });

  it('clears health when the backend monitor is stopped', () => {
    useSessionStore.getState().clearSessionHealth('ssh-test');
    expect(useSessionStore.getState().sessions[0].health).toBeUndefined();
  });

  it('ignores a late health result after disconnect', () => {
    useSessionStore.getState().updateSessionStatus('ssh-test', 'disconnected');
    useSessionStore.getState().updateSessionHealth('ssh-test', health);
    expect(useSessionStore.getState().sessions[0].health).toBeUndefined();
  });

  it('clears health when its tab closes', () => {
    useSessionStore.getState().closeTab('ssh-test');
    expect(useSessionStore.getState().sessions[0].health).toBeUndefined();
  });
});
