import { create } from 'zustand';
import { load } from '@tauri-apps/plugin-store';
import { useCredentialStore } from './useCredentialStore';

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
  health?: {
    cpu: number;
    ram: number;
    ram_used: number;
    ram_total: number;
    swap: number;
    swap_used: number;
    swap_total: number;
    disk: number;
  };
  tag?: 'prod' | 'staging' | 'dev' | 'custom';
  tagColor?: string;
  savePassword?: boolean;
  isFavorite?: boolean;
  os?: string;
  hasBell?: boolean;
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
    get().saveToDisk();
  },

  updateSession: (id, updates) => {
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    }));
    get().saveToDisk();
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
    get().saveToDisk();
  },

  updateSessionStatus: (id, status, error) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, status, error, lastActivity: Date.now() } : s,
      ),
    })),

  updateLastActivity: (id) => {
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, lastActivity: Date.now() } : s)),
    }));
  },

  updateSessionHealth: (id, health) => {
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, health } : s)),
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
    get().saveToDisk();
  },

  renameFolder: (id, name) => {
    set((state) => ({
      folders: state.folders.map((f) => (f.id === id ? { ...f, name } : f)),
    }));
    get().saveToDisk();
  },

  deleteFolder: (id) => {
    set((state) => ({
      folders: state.folders.filter((f) => f.id !== id),
      sessions: state.sessions.map((s) => (s.folderId === id ? { ...s, folderId: null } : s)),
    }));
    get().saveToDisk();
  },

  toggleFolderCollapse: (id) => {
    set((state) => ({
      folders: state.folders.map((f) => (f.id === id ? { ...f, isCollapsed: !f.isCollapsed } : f)),
    }));
    get().saveToDisk();
  },

  moveSessionToFolder: (sessionId, folderId) => {
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, folderId } : s)),
    }));
    get().saveToDisk();
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
          s.id === id ? { ...s, status: 'disconnected' as SessionStatus } : s,
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
    get().saveToDisk();
  },

  updateSnippet: (id, updates) => {
    set((state) => ({
      snippets: state.snippets.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    }));
    get().saveToDisk();
  },

  deleteSnippet: (id) => {
    set((state) => ({ snippets: state.snippets.filter((s) => s.id !== id) }));
    get().saveToDisk();
  },

  addWorkspace: (name) => {
    const { openTabs, activeSessionId } = get();
    const id = `workspace-${Date.now()}`;
    set((state) => ({
      workspaces: [...state.workspaces, { id, name, sessionIds: [...openTabs], activeSessionId }],
    }));
    get().saveToDisk();
  },

  deleteWorkspace: (id) => {
    set((state) => ({ workspaces: state.workspaces.filter((workspace) => workspace.id !== id) }));
    get().saveToDisk();
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
    get().saveToDisk();
  },

  clearConnectionHistory: () => {
    set({ connectionHistory: [] });
    get().saveToDisk();
  },

  loadSessions: async () => {
    try {
      const store = await load(STORAGE_PATH);
      const savedSessions = (await store.get<Session[]>('sessions')) || [];
      const savedFolders = (await store.get<Folder[]>('folders')) || [];
      const savedSnippets = (await store.get<Snippet[]>('snippets')) || [];
      const savedWorkspaces = (await store.get<Workspace[]>('workspaces')) || [];
      const savedHistory = (await store.get<ConnectionHistoryEntry[]>('connectionHistory')) || [];

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
      const store = await load(STORAGE_PATH);
      const toSave = state.sessions.map(
        ({ status, error, lastActivity, password, hasBell, ...s }) => s,
      );
      await store.set('sessions', toSave);
      await store.set('folders', state.folders);
      await store.set('snippets', state.snippets);
      await store.set('workspaces', state.workspaces);
      await store.set('connectionHistory', state.connectionHistory);
      await store.save();
    } catch (err) {
      console.error('[STORE] Failed to save sessions:', err);
    }
  },
}));
