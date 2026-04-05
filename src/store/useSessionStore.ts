import { create } from 'zustand';
import { load } from '@tauri-apps/plugin-store';

export type SessionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface Session {
  id: string;
  name: string;
  type: 'ssh' | 'local';
  host?: string;
  user?: string;
  port?: number;
  password?: string;
  status: SessionStatus;
  error?: string;
  lastActivity?: number;
  folderId?: string | null;  // New field for folder grouping
}

export interface Folder {
  id: string;
  name: string;
  isCollapsed: boolean;
}

interface SessionState {
  sessions: Session[];
  openTabs: string[];          // IDs of sessions currently open as tabs
  activeSessionId: string | null;
  isLoading: boolean;

  // Session CRUD
  addSession: (session: Session) => void;
  updateSession: (id: string, updates: Partial<Session>) => void;
  deleteSession: (id: string) => void;
  updateSessionStatus: (id: string, status: SessionStatus, error?: string) => void;
  updateLastActivity: (id: string) => void;

  // Tab management
  setActiveSession: (id: string) => void;
  openTab: (id: string) => void;
  closeTab: (id: string) => void;
  reorderTabs: (ids: string[]) => void;

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
}

const STORAGE_PATH = 'sessions.bin';

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [{ id: 'local', name: 'Local Terminal', type: 'local', status: 'connected' }],
  openTabs: ['local'],
  activeSessionId: 'local',
  isLoading: true,
  folders: [],

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
    console.log('[STORE] deleteSession starting for ID:', id);
    set((state) => {
      const newSessions = state.sessions.filter((s) => s.id !== id);
      const newTabs = state.openTabs.filter((t) => t !== id);
      const newActive =
        state.activeSessionId === id
          ? newTabs[newTabs.length - 1] || 'local'
          : state.activeSessionId;

      console.log(`[STORE] deleteSession: sessions from ${state.sessions.length} to ${newSessions.length}`);
      
      return {
        sessions: newSessions,
        openTabs: newTabs,
        activeSessionId: newActive,
      };
    });
    get().saveToDisk();
  },

  updateSessionStatus: (id, status, error) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, status, error, lastActivity: Date.now() } : s
      ),
    })),

  updateLastActivity: (id) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, lastActivity: Date.now() } : s
      ),
    })),

  setActiveSession: (id) => {
    const state = get();
    // If not already open as a tab, open it
    if (!state.openTabs.includes(id)) {
      set({ openTabs: [...state.openTabs, id], activeSessionId: id });
    } else {
      set({ activeSessionId: id });
    }
  },

  openTab: (id: string) => {
    const state = get();
    if (!state.openTabs.includes(id)) {
      set({ openTabs: [...state.openTabs, id], activeSessionId: id });
    } else {
      set({ activeSessionId: id });
    }
  },

  // Folder Actions
  addFolder: (name) => {
    const id = `folder-${Date.now()}`;
    set((state) => ({
      folders: [...state.folders, { id, name, isCollapsed: false }]
    }));
    get().saveToDisk();
  },

  renameFolder: (id, name) => {
    set((state) => ({
      folders: state.folders.map(f => f.id === id ? { ...f, name } : f)
    }));
    get().saveToDisk();
  },

  deleteFolder: (id) => {
    set((state) => ({
      folders: state.folders.filter(f => f.id !== id),
      sessions: state.sessions.map(s => s.folderId === id ? { ...s, folderId: null } : s)
    }));
    get().saveToDisk();
  },

  toggleFolderCollapse: (id) => {
    set((state) => ({
      folders: state.folders.map(f => f.id === id ? { ...f, isCollapsed: !f.isCollapsed } : f)
    }));
    get().saveToDisk();
  },

  moveSessionToFolder: (sessionId, folderId) => {
    set((state) => ({
      sessions: state.sessions.map(s => s.id === sessionId ? { ...s, folderId } : s)
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

    set({ openTabs: newTabs, activeSessionId: newActive });
  },

  reorderTabs: (ids) => set({ openTabs: ids }),

  loadSessions: async () => {
    try {
      const store = await load(STORAGE_PATH);
      const savedSessions = await store.get<Session[]>('sessions');
      const savedFolders = await store.get<Folder[]>('folders') || [];
      
      if (savedSessions && savedSessions.length > 0) {
        const local: Session = { id: 'local', name: 'Local Terminal', type: 'local', status: 'connected' };
        const filteredSaved = savedSessions
          .filter((s) => s.id !== 'local')
          .map((s) => ({ ...s, status: 'disconnected' as SessionStatus }));
        set({
          sessions: [local, ...filteredSaved],
          folders: savedFolders,
          openTabs: ['local'],
          activeSessionId: 'local',
          isLoading: false,
        });
      } else {
        set({ isLoading: false, folders: savedFolders });
      }
    } catch (err) {
      console.error('Failed to load sessions:', err);
      set({ isLoading: false });
    }
  },

  saveToDisk: async () => {
    try {
      const state = get();
      const store = await load(STORAGE_PATH);
      const toSave = state.sessions.map(({ status, error, lastActivity, ...s }) => s);
      console.log('[STORE] Saving to disk, session count:', toSave.length);
      await store.set('sessions', toSave);
      await store.set('folders', state.folders);
      await store.save();
      console.log('[STORE] Successfully saved to disk');
    } catch (err) {
      console.error('[STORE] Failed to save sessions:', err);
    }
  },
}));
