import { create } from 'zustand';
import { load } from '@tauri-apps/plugin-store';
import { invoke } from '@tauri-apps/api/core';
import { useCredentialStore } from './useCredentialStore';
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
  sessionIds: string[];
  activeSessionId: string | null;
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
  addWorkspace: (name: string) => void;
  deleteWorkspace: (id: string) => void;
  restoreWorkspace: (id: string) => void;

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
    set((state) => {
      const newSessions = state.sessions.filter((s) => s.id !== id);
      const newTabs = state.openTabs.filter((t) => t !== id);
      const newActive =
        state.activeSessionId === id
          ? newTabs[newTabs.length - 1] || 'local'
          : state.activeSessionId;
      return {
        sessions: newSessions,
        openTabs: newTabs,
        activeSessionId: newActive,
        workspaces: state.workspaces.map((workspace) => {
          const sessionIds = workspace.sessionIds.filter((sessionId) => sessionId !== id);
          return {
            ...workspace,
            sessionIds,
            activeSessionId:
              workspace.activeSessionId === id
                ? (sessionIds[0] ?? null)
                : workspace.activeSessionId,
          };
        }),
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

    // Mark SSH sessions as disconnected so re-opening reconnects
    const session = state.sessions.find((s) => s.id === id);
    if (session?.type === 'ssh') {
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
    const { openTabs } = get();
    // Disconnect all SSH sessions
    for (const id of openTabs) {
      if (id.startsWith('ssh-')) {
        try {
          await (await import('@tauri-apps/api/core')).invoke('ssh_disconnect', { sessionId: id });
        } catch (err) {
          console.warn(`[STORE] Failed to disconnect ${id}:`, err);
        }
      }
    }
    // Clear all tabs
    set({ openTabs: ['local'], activeSessionId: 'local' });

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

  addWorkspace: (name) => {
    const { openTabs, activeSessionId } = get();
    const id = `workspace-${Date.now()}`;
    set((state) => ({
      workspaces: [...state.workspaces, { id, name, sessionIds: [...openTabs], activeSessionId }],
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
    if (!workspace) return;
    const existingIds = new Set(state.sessions.map((session) => session.id));
    const sessionIds = workspace.sessionIds.filter((sessionId) => existingIds.has(sessionId));
    const restoredTabs = sessionIds.length ? sessionIds : ['local'];
    const activeSessionId =
      workspace.activeSessionId && restoredTabs.includes(workspace.activeSessionId)
        ? workspace.activeSessionId
        : restoredTabs[0];
    set({ openTabs: restoredTabs, activeSessionId });
  },

  recordConnection: (sessionId, status, message) => {
    const session = get().sessions.find((item) => item.id === sessionId);
    if (!session) return;
    const entry: ConnectionHistoryEntry = {
      id: `history-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      sessionId,
      sessionName: session.name,
      host: session.host,
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
      const toSave = state.sessions.map(
        ({ status, error, lastActivity, password, hasBell, health, healthHistory, ...s }) => s,
      );
      await invoke('save_app_data', {
        document: {
          schemaVersion: 1,
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
