import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { PortForward } from '../types/portForward';

interface ForwardState {
  forwards: PortForward[];
  isLoading: boolean;
  error: string | null;
  fetchForwards: () => Promise<void>;
  addLocal: (
    sessionId: string,
    targetHost: string,
    targetPort: number,
    bindPort: number,
  ) => Promise<void>;
  addDynamic: (sessionId: string, bindPort: number) => Promise<void>;
  removeForward: (forwardId: string) => Promise<void>;
  reset: () => void;
}

export const useForwardStore = create<ForwardState>((set, get) => ({
  forwards: [],
  isLoading: false,
  error: null,

  fetchForwards: async () => {
    try {
      const forwards = await invoke<PortForward[]>('ssh_forward_list');
      set({ forwards, error: null });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  addLocal: async (sessionId, targetHost, targetPort, bindPort) => {
    set({ isLoading: true, error: null });
    try {
      await invoke('ssh_forward_add_local', {
        sessionId,
        bindHost: '127.0.0.1',
        bindPort,
        targetHost,
        targetPort,
      });
      await get().fetchForwards();
    } catch (err) {
      set({ error: String(err) });
    }
    set({ isLoading: false });
  },

  addDynamic: async (sessionId, bindPort) => {
    set({ isLoading: true, error: null });
    try {
      await invoke('ssh_forward_add_dynamic', {
        sessionId,
        bindHost: '127.0.0.1',
        bindPort,
      });
      await get().fetchForwards();
    } catch (err) {
      set({ error: String(err) });
    }
    set({ isLoading: false });
  },

  removeForward: async (forwardId) => {
    try {
      await invoke('ssh_forward_remove', { forwardId });
      await get().fetchForwards();
    } catch (err) {
      set({ error: String(err) });
    }
  },

  reset: () => set({ forwards: [], isLoading: false, error: null }),
}));
