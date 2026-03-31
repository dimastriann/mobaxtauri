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
}

interface SessionState {
  sessions: Session[];
  activeSessionId: string | null;
  isLoading: boolean;
  addSession: (session: Session) => void;
  updateSession: (id: string, updates: Partial<Session>) => void;
  deleteSession: (id: string) => void;
  setActiveSession: (id: string) => void;
  updateSessionStatus: (id: string, status: SessionStatus, error?: string) => void;
  loadSessions: () => Promise<void>;
  saveToDisk: () => Promise<void>;
}

const STORAGE_PATH = 'sessions.bin';

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [{ id: 'local', name: 'Local Terminal', type: 'local', status: 'connected' }],
  activeSessionId: 'local',
  isLoading: true,

  addSession: (session) => {
    set((state) => ({ 
      sessions: [...state.sessions, session],
      activeSessionId: session.id 
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
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
      activeSessionId: state.activeSessionId === id ? 'local' : state.activeSessionId,
    }));
    get().saveToDisk();
  },

  setActiveSession: (id) => set({ activeSessionId: id }),

  updateSessionStatus: (id, status, error) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, status, error } : s
      ),
    })),

  loadSessions: async () => {
    try {
      const store = await load(STORAGE_PATH);
      const savedSessions = await store.get<Session[]>('sessions');
      if (savedSessions && savedSessions.length > 0) {
        // Merge with local terminal
        const local: Session = { id: 'local', name: 'Local Terminal', type: 'local', status: 'connected' };
        const filteredSaved = savedSessions.filter(s => s.id !== 'local').map(s => ({...s, status: 'disconnected' as SessionStatus}));
        set({ sessions: [local, ...filteredSaved], isLoading: false });
      } else {
        set({ isLoading: false });
      }
    } catch (err) {
      console.error('Failed to load sessions:', err);
      set({ isLoading: false });
    }
  },

  saveToDisk: async () => {
    try {
      const store = await load(STORAGE_PATH);
      // Don't save transient state like 'status' or 'password' (ideally stronghold for password)
      const toSave = get().sessions.map(({ status, error, ...s }) => s);
      await store.set('sessions', toSave);
      await store.save();
    } catch (err) {
      console.error('Failed to save sessions:', err);
    }
  },
}));
