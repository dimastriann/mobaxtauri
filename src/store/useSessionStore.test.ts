import { beforeEach, describe, expect, it } from 'vitest';
import { Session, useSessionStore } from './useSessionStore';

const health: NonNullable<Session['health']> = {
  timestamp: Date.now(),
  cpu: 10,
  ram: 20,
  ram_used: 200,
  ram_total: 1000,
  swap: 0,
  swap_used: 0,
  swap_total: 0,
  disk: 30,
};

describe('session instances', () => {
  beforeEach(() => {
    useSessionStore.setState({
      sessions: [
        { id: 'local', name: 'Local Terminal', type: 'local', status: 'connected' },
        {
          id: 'ssh-prod',
          name: 'Production',
          type: 'ssh',
          host: 'prod',
          user: 'root',
          status: 'disconnected',
        },
      ],
      openTabs: ['local'],
      activeSessionId: 'local',
      workspaces: [],
      connectionHistory: [],
    });
  });

  it('opens an existing instance instead of duplicating the config tab', () => {
    const store = useSessionStore.getState();
    store.openConfig('ssh-prod');
    const firstTab = useSessionStore.getState().activeSessionId;
    expect(firstTab).toBe('ssh-prod');

    useSessionStore.getState().openConfig('ssh-prod');
    expect(useSessionStore.getState().openTabs).toEqual(['local', 'ssh-prod']);
  });

  it('opens multiple independent instances from one config', () => {
    useSessionStore.getState().openNewInstance('ssh-prod');
    useSessionStore.getState().openNewInstance('ssh-prod');

    const state = useSessionStore.getState();
    const instances = state.sessions.filter((session) => session.configId === 'ssh-prod');
    expect(instances).toHaveLength(1);
    expect(instances[0].ephemeral).toBe(true);
    expect(state.openTabs).toContain('ssh-prod');
    expect(state.openTabs).toContain(instances[0].id);
    expect(state.activeSessionId).toBe(instances[0].id);
  });

  it('closes one instance without removing the saved config', () => {
    useSessionStore.getState().openNewInstance('ssh-prod');
    useSessionStore.getState().openNewInstance('ssh-prod');
    const instanceId = useSessionStore.getState().activeSessionId!;

    useSessionStore.getState().closeTab(instanceId);

    const state = useSessionStore.getState();
    expect(state.sessions.some((session) => session.id === 'ssh-prod')).toBe(true);
    expect(state.sessions.some((session) => session.id === instanceId)).toBe(false);
    expect(state.openTabs).not.toContain(instanceId);
  });

  it('deleting a config closes all of its instances', () => {
    useSessionStore.getState().openNewInstance('ssh-prod');
    useSessionStore.getState().openNewInstance('ssh-prod');

    useSessionStore.getState().deleteSession('ssh-prod');

    const state = useSessionStore.getState();
    expect(state.sessions.some((session) => session.id === 'ssh-prod')).toBe(false);
    expect(state.sessions.some((session) => session.configId === 'ssh-prod')).toBe(false);
    expect(state.openTabs).toEqual(['local']);
  });

  it('restores duplicate workspace entries as separate instances', () => {
    useSessionStore.getState().openNewInstance('ssh-prod');
    useSessionStore.getState().openNewInstance('ssh-prod');
    useSessionStore.getState().addWorkspace('Production tabs');
    const workspace = useSessionStore.getState().workspaces[0];
    expect(workspace.configIds).toEqual(['local', 'ssh-prod', 'ssh-prod']);

    useSessionStore.setState({ openTabs: ['local'], activeSessionId: 'local' });
    useSessionStore.getState().restoreWorkspace(workspace.id);

    const state = useSessionStore.getState();
    expect(state.sessions.some((session) => session.id === 'ssh-prod')).toBe(true);
    expect(state.sessions.filter((session) => session.configId === 'ssh-prod')).toHaveLength(1);
    expect(state.openTabs).toHaveLength(3);
    expect(state.activeSessionId).toBe(state.openTabs[workspace.activeIndex]);
  });
});

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
