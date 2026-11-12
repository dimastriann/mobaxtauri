import { create } from 'zustand';
import { load } from '@tauri-apps/plugin-store';
import { invoke } from '@tauri-apps/api/core';
import { useCredentialStore } from './useCredentialStore';
import {
  normalizeActivePaneIndex,
  normalizePaneIndices,
  normalizePaneLayout,
  removeConfigFromPaneLayout,
  type WorkspacePaneLayout,
} from '../utils/workspacePanes';
import type { SshHealthSnapshot } from '../types/ssh';

export type SessionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface Session {
  id: string;
  name: string;
  type: 'ssh' | 'local';
  host?: string;
  user?: string;
  port?: number;
  password?: string;
  privateKeyPath?: string;
  useAgent?: boolean;
  /** Allow keyboard-interactive/OTP prompts after password auth fails. */
  allowKeyboardInteractive?: boolean;
  /** Saved profile this runtime instance was opened from. */
  configId?: string;
  /** Connected bastion profile used as a ProxyJump transport. */
  jumpSessionId?: string;
  /** Optional command sent to the shell immediately after connecting. */
  startupCommand?: string;
  status: SessionStatus;
  error?: string;
  lastActivity?: number;
  folderId?: string | null;
  health?: SshHealthSnapshot;
  healthHistory?: SshHealthSnapshot[];
  tag?: 'prod' | 'staging' | 'dev' | 'custom';
  tagColor?: string;
  savePassword?: boolean;
  isFavorite?: boolean;
  os?: string;
  hasBell?: boolean;
  ephemeral?: boolean;
}

/** The saved profile behind a tab (config id for instances). */
export const sessionConfigId = (session: Session): string => session.configId ?? session.id;

/** Whether the tab/instance was opened from `configId`. */
export const sessionBelongsToConfig = (session: Session, configId: string): boolean =>
  session.id === configId || session.configId === configId;

/** Open tab id for a saved config, if any instance is currently open. */
export const findOpenInstanceId = (
  sessions: Session[],
  openTabs: string[],
  configId: string,
): string | null => {
  for (const tabId of openTabs) {
    const session = sessions.find((entry) => entry.id === tabId);
    if (session && sessionBelongsToConfig(session, configId)) return tabId;
  }
  return null;
};

const createInstanceId = (configId: string) =>
  `${configId}::instance-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const createSessionInstance = (config: Session): Session => ({
  ...config,
  id: createInstanceId(config.id),
  configId: config.id,
  ephemeral: true,
  status: 'disconnected',
  error: undefined,
  lastActivity: Date.now(),
  health: undefined,
  healthHistory: undefined,
  hasBell: false,
});

/** The terminal unmount path cannot disconnect a row that was already
 * removed from the store, so close/delete paths disconnect first. */
const disconnectSshInstances = (sessions: Session[], ids: Iterable<string>) => {
  const targets = new Set(ids);
  for (const session of sessions) {
    if (targets.has(session.id) && session.type === 'ssh') {
      invoke('ssh_disconnect', { sessionId: session.id }).catch((error: unknown) => {
        console.warn(`[STORE] Failed to disconnect ${session.id}:`, error);
      });
    }
  }
};

export interface Folder {
  id: string;
  name: string;
  isCollapsed: boolean;
}

export interface Snippet {
  id: string;
  name: string;
  command: string;
}

export interface Workspace {
  id: string;
  name: string;
  /** Saved profiles in tab order; duplicates mean multiple instances. */
  configIds: string[];
  activeIndex: number;
  /** Indices into `configIds` shown in the terminal pane grid. */
  paneIndices: number[];
  /** Index into `paneIndices` that owns keyboard focus. */
  activePaneIndex: number;
  paneLayout: WorkspacePaneLayout;
}

export interface RestoredWorkspace {
  tabIds: string[];
  activeIndex: number;
  paneIndices: number[];
  activePaneIndex: number;
  paneLayout: WorkspacePaneLayout;
}

export interface ConnectionHistoryEntry {
  id: string;
  sessionId: string;
  sessionName: string;
  host?: string;
  status: 'connected' | 'failed' | 'disconnected';
  timestamp: number;
  message?: string;
}

interface SessionState {
  sessions: Session[];
  openTabs: string[]; // IDs of sessions currently open as tabs
  activeSessionId: string | null;
  isLoading: boolean;

  // Session CRUD
  addSession: (session: Session) => void;
  updateSession: (id: string, updates: Partial<Session>) => void;
  deleteSession: (id: string) => void;
  updateSessionStatus: (id: string, status: SessionStatus, error?: string) => void;
  updateLastActivity: (id: string) => void;
  updateSessionHealth: (id: string, health: NonNullable<Session['health']>) => void;
  clearSessionHealth: (id: string) => void;
  updateSessionBell: (id: string, hasBell: boolean) => void;

  // Tab management
  setActiveSession: (id: string) => void;
  openTab: (id: string) => void;
  /** Activate an existing instance of `configId`, or open the config itself. */
  openConfig: (configId: string) => void;
  /** Open another independent connection from the same saved config. */
  openNewInstance: (configId: string) => void;
  closeTab: (id: string) => void;
  reorderTabs: (ids: string[]) => void;
  shutdownAll: () => Promise<void>;

  // Folder Management
  folders: Folder[];
  addFolder: (name: string) => void;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;
  toggleFolderCollapse: (id: string) => void;
  moveSessionToFolder: (sessionId: string, folderId: string | null) => void;

  // Persistence
  loadSessions: () => Promise<void>;
  saveToDisk: () => Promise<void>;
  scheduleSave: () => void;
  flushPendingSave: () => Promise<void>;

  // Snippet Management
  snippets: Snippet[];
  addSnippet: (name: string, command: string) => void;
  updateSnippet: (id: string, updates: Partial<Snippet>) => void;
  deleteSnippet: (id: string) => void;

  // Workspace Management
  workspaces: Workspace[];
  addWorkspace: (
    name: string,
    paneIndices?: number[],
    activePaneIndex?: number,
    paneLayout?: WorkspacePaneLayout,
  ) => void;
  deleteWorkspace: (id: string) => void;
  restoreWorkspace: (id: string) => RestoredWorkspace | null;

  // Connection History
  connectionHistory: ConnectionHistoryEntry[];
  recordConnection: (
    sessionId: string,
    status: ConnectionHistoryEntry['status'],
    message?: string,
  ) => void;
  clearConnectionHistory: () => void;
}

const STORAGE_PATH = 'sessions.bin';

interface PersistedAppData {
  schemaVersion: number;
  sessions: PersistedSession[];
  folders: Folder[];
  snippets: Snippet[];
  workspaces: Workspace[];
  connectionHistory: ConnectionHistoryEntry[];
}

type PersistedSession = Omit<Session, 'status'> & { status?: SessionStatus };

type StoredWorkspace = Partial<Workspace> & {
  sessionIds?: string[];
  activeSessionId?: string | null;
};

const normalizeWorkspace = (workspace: StoredWorkspace): Workspace => {
  const configIds = workspace.configIds ?? workspace.sessionIds ?? [];
  const activeIndex = workspace.configIds
    ? (workspace.activeIndex ?? 0)
    : Math.max(configIds.indexOf(workspace.activeSessionId ?? ''), 0);
  const boundedActiveIndex = Math.min(Math.max(activeIndex, 0), Math.max(configIds.length - 1, 0));
  const paneIndices = normalizePaneIndices(
    workspace.paneIndices,
    configIds.length,
    boundedActiveIndex,
  );
  return {
    id: workspace.id ?? `workspace-${Date.now()}`,
    name: workspace.name ?? 'Workspace',
    configIds,
    activeIndex: boundedActiveIndex,
    paneIndices,
    activePaneIndex: normalizeActivePaneIndex(workspace.activePaneIndex, paneIndices.length),
    paneLayout: normalizePaneLayout(workspace.paneLayout, paneIndices.length),
  };
};

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [{ id: 'local', name: 'Local Terminal', type: 'local', status: 'connected' }],
  openTabs: ['local'],
  activeSessionId: 'local',
  isLoading: true,
  folders: [],
  snippets: [],
  workspaces: [],
  connectionHistory: [],

  addSession: (session) => {
    set((state) => ({
      sessions: [...state.sessions, session],
      openTabs: [...state.openTabs, session.id],
      activeSessionId: session.id,
    }));
    get().scheduleSave();
  },

  updateSession: (id, updates) => {
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    }));
    get().scheduleSave();
  },

  deleteSession: (id) => {
    const current = get();
    const configuredInstances = new Set(
      current.sessions
        .filter((session) => session.id === id || session.configId === id)
        .map((session) => session.id),
    );
    configuredInstances.add(id);
    disconnectSshInstances(current.sessions, configuredInstances);
    set((state) => {
      const removedIds = new Set(
        state.sessions
          .filter((session) => session.id === id || session.configId === id)
          .map((session) => session.id),
      );
      removedIds.add(id);
      const newSessions = state.sessions.filter((session) => !removedIds.has(session.id));
      const newTabs = state.openTabs.filter((tabId) => !removedIds.has(tabId));
      const newActive =
        state.activeSessionId && removedIds.has(state.activeSessionId)
          ? newTabs[newTabs.length - 1] || 'local'
          : state.activeSessionId;
      return {
        sessions: newSessions,
        openTabs: newTabs,
        activeSessionId: newActive,
        workspaces: state.workspaces.map((workspace) => removeConfigFromPaneLayout(workspace, id)),
      };
    });
    get().scheduleSave();
  },

  updateSessionStatus: (id, status, error) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id
          ? {
              ...s,
              status,
              error,
              lastActivity: Date.now(),
              health: status === 'connected' ? s.health : undefined,
              healthHistory: status === 'connected' ? s.healthHistory : undefined,
            }
          : s,
      ),
    })),

  updateLastActivity: (id) => {
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, lastActivity: Date.now() } : s)),
    }));
  },

  updateSessionHealth: (id, health) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id && s.status === 'connected' && state.openTabs.includes(id)
          ? {
              ...s,
              health,
              healthHistory: [...(s.healthHistory ?? []), health].slice(-30),
            }
          : s,
      ),
    }));
  },

  clearSessionHealth: (id) => {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, health: undefined, healthHistory: undefined } : session,
      ),
    }));
  },

  updateSessionBell: (id, hasBell) => {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, hasBell } : session,
      ),
    }));
  },

  setActiveSession: (id) => {
    // Alias kept for interface compatibility — delegates to openTab logic
    const state = get();
    if (!state.openTabs.includes(id)) {
      set({
        sessions: state.sessions.map((session) =>
          session.id === id ? { ...session, hasBell: false } : session,
        ),
        openTabs: [...state.openTabs, id],
        activeSessionId: id,
      });
    } else {
      set({
        sessions: state.sessions.map((session) =>
          session.id === id ? { ...session, hasBell: false } : session,
        ),
        activeSessionId: id,
      });
    }
  },

  openTab: (id: string) => {
    const state = get();
    if (!state.openTabs.includes(id)) {
      set({
        sessions: state.sessions.map((session) =>
          session.id === id ? { ...session, hasBell: false } : session,
        ),
        openTabs: [...state.openTabs, id],
        activeSessionId: id,
      });
    } else {
      set({
        sessions: state.sessions.map((session) =>
          session.id === id ? { ...session, hasBell: false } : session,
        ),
        activeSessionId: id,
      });
    }
  },

  openConfig: (configId: string) => {
    const state = get();
    if (!state.sessions.some((session) => session.id === configId && !session.ephemeral)) {
      return;
    }
    const existing = state.openTabs.find((id) => {
      const session = state.sessions.find((entry) => entry.id === id);
      return session ? sessionBelongsToConfig(session, configId) : false;
    });
    if (existing) {
      get().setActiveSession(existing);
      return;
    }
    get().openTab(configId);
  },

  openNewInstance: (configId: string) => {
    const state = get();
    const config = state.sessions.find((session) => session.id === configId && !session.ephemeral);
    const alreadyOpen = state.openTabs.some((tabId) => {
      const tab = state.sessions.find((session) => session.id === tabId);
      return tab ? sessionBelongsToConfig(tab, configId) : false;
    });
    if (!config || config.type === 'local' || !alreadyOpen) {
      get().openConfig(configId);
      return;
    }
    const instance = createSessionInstance(config);
    set({
      sessions: [...state.sessions, instance],
      openTabs: [...state.openTabs, instance.id],
      activeSessionId: instance.id,
    });
  },

  // Folder Actions
  addFolder: (name) => {
    const id = `folder-${Date.now()}`;
    set((state) => ({
      folders: [...state.folders, { id, name, isCollapsed: false }],
    }));
    get().scheduleSave();
  },

  renameFolder: (id, name) => {
    set((state) => ({
      folders: state.folders.map((f) => (f.id === id ? { ...f, name } : f)),
    }));
    get().scheduleSave();
  },

  deleteFolder: (id) => {
    set((state) => ({
      folders: state.folders.filter((f) => f.id !== id),
      sessions: state.sessions.map((s) => (s.folderId === id ? { ...s, folderId: null } : s)),
    }));
    get().scheduleSave();
  },

  toggleFolderCollapse: (id) => {
    set((state) => ({
      folders: state.folders.map((f) => (f.id === id ? { ...f, isCollapsed: !f.isCollapsed } : f)),
    }));
    get().scheduleSave();
  },

  moveSessionToFolder: (sessionId, folderId) => {
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, folderId } : s)),
    }));
    get().scheduleSave();
  },

  closeTab: (id) => {
    const state = get();
    disconnectSshInstances(state.sessions, [id]);
    const idx = state.openTabs.indexOf(id);
    const newTabs = state.openTabs.filter((t) => t !== id);

    let newActive = state.activeSessionId;
    if (state.activeSessionId === id) {
      // Switch to the nearest tab
      if (newTabs.length > 0) {
        newActive = newTabs[Math.min(idx, newTabs.length - 1)];
      } else {
        newActive = null;
      }
    }

    const session = state.sessions.find((s) => s.id === id);
    if (session?.ephemeral) {
      // Runtime instances and quick-connect sessions leave no profile row.
      set({
        sessions: state.sessions.filter((s) => s.id !== id),
        openTabs: newTabs,
        activeSessionId: newActive,
      });
    } else if (session?.type === 'ssh') {
      set({
        sessions: state.sessions.map((s) =>
          s.id === id
            ? {
                ...s,
                status: 'disconnected' as SessionStatus,
                health: undefined,
                healthHistory: undefined,
              }
            : s,
        ),
        openTabs: newTabs,
        activeSessionId: newActive,
      });
    } else {
      set({ openTabs: newTabs, activeSessionId: newActive });
    }
  },

  reorderTabs: (ids) => set({ openTabs: ids }),

  shutdownAll: async () => {
    const { openTabs, sessions } = get();
    // Disconnect every live SSH instance, including clones and quick connects.
    for (const id of openTabs) {
      const session = sessions.find((entry) => entry.id === id);
      if (session?.type !== 'ssh') continue;
      try {
        await (await import('@tauri-apps/api/core')).invoke('ssh_disconnect', { sessionId: id });
      } catch (err) {
        console.warn(`[STORE] Failed to disconnect ${id}:`, err);
      }
    }
    // Drop runtime instances and quick-connect rows; saved profiles remain.
    set((state) => ({
      sessions: state.sessions.filter((session) => !session.ephemeral),
      openTabs: ['local'],
      activeSessionId: 'local',
    }));

    // SFTP store resets automatically when activeSessionId changes in SftpSidebar
  },

  addSnippet: (name, command) => {
    const id = `snippet-${Date.now()}`;
    set((state) => ({ snippets: [...state.snippets, { id, name, command }] }));
    get().scheduleSave();
  },

  updateSnippet: (id, updates) => {
    set((state) => ({
      snippets: state.snippets.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    }));
    get().scheduleSave();
  },

  deleteSnippet: (id) => {
    set((state) => ({ snippets: state.snippets.filter((s) => s.id !== id) }));
    get().scheduleSave();
  },

  addWorkspace: (name, paneIndices, activePaneIndex, paneLayout) => {
    const { openTabs, activeSessionId, sessions } = get();
    const configIds = openTabs.map((tabId) => {
      const session = sessions.find((entry) => entry.id === tabId);
      return session ? sessionConfigId(session) : tabId;
    });
    const activeIndex = Math.max(openTabs.indexOf(activeSessionId ?? ''), 0);
    const boundedActiveIndex = Math.min(activeIndex, Math.max(configIds.length - 1, 0));
    const normalizedPanes = normalizePaneIndices(paneIndices, configIds.length, boundedActiveIndex);
    const id = `workspace-${Date.now()}`;
    set((state) => ({
      workspaces: [
        ...state.workspaces,
        {
          id,
          name,
          configIds,
          activeIndex: boundedActiveIndex,
          paneIndices: normalizedPanes,
          activePaneIndex: normalizeActivePaneIndex(activePaneIndex, normalizedPanes.length),
          paneLayout: normalizePaneLayout(paneLayout, normalizedPanes.length),
        },
      ],
    }));
    get().scheduleSave();
  },

  deleteWorkspace: (id) => {
    set((state) => ({ workspaces: state.workspaces.filter((workspace) => workspace.id !== id) }));
    get().scheduleSave();
  },

  restoreWorkspace: (id) => {
    const state = get();
    const workspace = state.workspaces.find((item) => item.id === id);
    if (!workspace) return null;

    const restoredSessions: Session[] = [];
    const restoredTabs: string[] = [];
    const configTabs: (string | null)[] = [];
    const openedConfigs = new Set<string>();
    for (const configId of workspace.configIds) {
      const config = state.sessions.find(
        (session) => session.id === configId && !session.ephemeral,
      );
      if (configId === 'local' || config?.type === 'local') {
        if (!openedConfigs.has('local')) {
          openedConfigs.add('local');
          restoredTabs.push('local');
        }
        configTabs.push('local');
        continue;
      }
      if (!config) {
        configTabs.push(null);
        continue;
      }
      if (!openedConfigs.has(configId)) {
        openedConfigs.add(configId);
        restoredTabs.push(config.id);
        configTabs.push(config.id);
        continue;
      }
      const instance = createSessionInstance(config);
      restoredSessions.push(instance);
      restoredTabs.push(instance.id);
      configTabs.push(instance.id);
    }

    const tabs = restoredTabs.length ? restoredTabs : ['local'];
    const activeIndex = Math.min(Math.max(workspace.activeIndex, 0), tabs.length - 1);
    const mappedPanes = workspace.paneIndices
      .map((index) => configTabs[index])
      .filter((tabId): tabId is string => Boolean(tabId))
      .map((tabId) => tabs.indexOf(tabId))
      .filter((index) => index >= 0);
    const paneIndices = normalizePaneIndices(mappedPanes, tabs.length, activeIndex);
    let activePaneIndex = mappedPanes.indexOf(activeIndex);
    if (activePaneIndex < 0) activePaneIndex = workspace.activePaneIndex;
    activePaneIndex = normalizeActivePaneIndex(activePaneIndex, paneIndices.length);
    const paneLayout = normalizePaneLayout(workspace.paneLayout, paneIndices.length);

    disconnectSshInstances(
      state.sessions,
      state.sessions
        .filter((session) => session.ephemeral && !tabs.includes(session.id))
        .map((session) => session.id),
    );
    set((current) => ({
      sessions: [
        ...current.sessions.filter((session) => !session.ephemeral || tabs.includes(session.id)),
        ...restoredSessions,
      ],
      openTabs: tabs,
      activeSessionId: tabs[activeIndex],
    }));
    return { tabIds: tabs, activeIndex, paneIndices, activePaneIndex, paneLayout };
  },

  recordConnection: (sessionId, status, message) => {
    const sessions = get().sessions;
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;
    const config = session.configId
      ? sessions.find((item) => item.id === session.configId && !item.ephemeral)
      : session;
    const entry: ConnectionHistoryEntry = {
      id: `history-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      sessionId: config?.id ?? sessionId,
      sessionName: config?.name ?? session.name,
      host: config?.host ?? session.host,
      status,
      timestamp: Date.now(),
      message,
    };
    set((state) => ({ connectionHistory: [entry, ...state.connectionHistory].slice(0, 200) }));
    get().scheduleSave();
  },

  clearConnectionHistory: () => {
    set({ connectionHistory: [] });
    get().scheduleSave();
  },

  loadSessions: async () => {
    try {
      const persisted = await invoke<PersistedAppData | null>('load_app_data');
      let savedSessions: PersistedSession[];
      let savedFolders: Folder[];
      let savedSnippets: Snippet[];
      let savedWorkspaces: Workspace[];
      let savedHistory: ConnectionHistoryEntry[];

      if (persisted) {
        savedSessions = persisted.sessions;
        savedFolders = persisted.folders;
        savedSnippets = persisted.snippets;
        savedWorkspaces = persisted.workspaces;
        savedHistory = persisted.connectionHistory;
      } else {
        const legacyStore = await load(STORAGE_PATH);
        savedSessions = (await legacyStore.get<Session[]>('sessions')) || [];
        savedFolders = (await legacyStore.get<Folder[]>('folders')) || [];
        savedSnippets = (await legacyStore.get<Snippet[]>('snippets')) || [];
        savedWorkspaces = (await legacyStore.get<Workspace[]>('workspaces')) || [];
        savedHistory = (await legacyStore.get<ConnectionHistoryEntry[]>('connectionHistory')) || [];
      }

      savedWorkspaces = (savedWorkspaces as StoredWorkspace[]).map(normalizeWorkspace);

      const local: Session = {
        id: 'local',
        name: 'Local Terminal',
        type: 'local',
        status: 'connected',
      };

      // Filter out any existing 'local' session from disk to prevent duplicates
      const legacyCredentials = savedSessions
        .filter((session) => session.password)
        .map((session) => ({ id: session.id, password: session.password! }));
      const filteredSaved = savedSessions
        .filter((s) => s.id !== 'local')
        .map(({ password, ...session }) => ({
          ...session,
          savePassword: password ? true : session.savePassword,
          status: 'disconnected' as SessionStatus,
        }));

      set({
        sessions: [local, ...filteredSaved],
        folders: savedFolders,
        snippets: savedSnippets,
        workspaces: savedWorkspaces,
        connectionHistory: savedHistory,
        openTabs: ['local'],
        activeSessionId: 'local',
        isLoading: false,
      });

      if (!persisted) {
        await get().saveToDisk();
      }

      // Legacy plaintext credential migration is best-effort and must never
      // block the session list from becoming usable.
      if (legacyCredentials.length) {
        void (async () => {
          const unlocked = await useCredentialStore.getState().unlock();
          if (!unlocked) return;
          for (const credential of legacyCredentials) {
            try {
              await useCredentialStore
                .getState()
                .saveCredential(credential.id, credential.password);
            } catch (err) {
              console.error(`[STORE] Migration failed for session ${credential.id}:`, err);
              return;
            }
          }
          await get().saveToDisk();
        })();
      }
    } catch (err) {
      console.error('Failed to load sessions:', err);
      // Fallback to defaults
      set({
        sessions: [{ id: 'local', name: 'Local Terminal', type: 'local', status: 'connected' }],
        folders: [],
        snippets: [],
        workspaces: [],
        connectionHistory: [],
        isLoading: false,
      });
    }
  },

  saveToDisk: async () => {
    try {
      const state = get();
      const toSave = state.sessions
        .filter((session) => !session.ephemeral)
        .map(
          ({
            status: _status,
            error: _error,
            lastActivity: _lastActivity,
            password: _password,
            hasBell: _hasBell,
            health: _health,
            healthHistory: _healthHistory,
            configId: _configId,
            ...s
          }) => s,
        );
      await invoke('save_app_data', {
        document: {
          schemaVersion: 3,
          sessions: toSave,
          folders: state.folders,
          snippets: state.snippets,
          workspaces: state.workspaces,
          connectionHistory: state.connectionHistory,
        } satisfies PersistedAppData,
      });
    } catch (err) {
      console.error('[STORE] Failed to save sessions:', err);
    }
  },

  // Coalesce rapid mutations into one disk write. Every folder/tag/rename
  // edit used to enqueue its own full-document save; the backend write path
  // is serialized, so bursts made the last save wait in line.
  scheduleSave: () => {
    if (saveTimer !== null) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void get().saveToDisk();
    }, SAVE_DEBOUNCE_MS);
  },

  // Force a pending debounced write to run now (used before the app hides).
  flushPendingSave: async () => {
    if (saveTimer === null) {
      await get().saveToDisk();
      return;
    }
    clearTimeout(saveTimer);
    saveTimer = null;
    await get().saveToDisk();
  },
}));

const SAVE_DEBOUNCE_MS = 300;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

// Persist any pending debounced write when the webview loses forward
// visibility (window close, minimize, focus loss), so the last edits are
// never lost because a 300 ms timer never fired.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void useSessionStore.getState().flushPendingSave();
    }
  });
}
