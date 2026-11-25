import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { SyncApplyResult, SyncConflictPolicy, SyncDirection, SyncPlan } from '../types/sync';

interface SyncState {
  plan: SyncPlan | null;
  isPlanning: boolean;
  isApplying: boolean;
  error: string | null;
  lastResult: SyncApplyResult | null;

  preview: (input: {
    sessionId: string;
    localPath: string;
    remotePath: string;
    direction: SyncDirection;
    conflictPolicy: SyncConflictPolicy;
    deleteTargetOnly: boolean;
  }) => Promise<SyncPlan | null>;
  apply: (sessionId: string, plan: SyncPlan) => Promise<SyncApplyResult | null>;
  clear: () => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  plan: null,
  isPlanning: false,
  isApplying: false,
  error: null,
  lastResult: null,

  preview: async (input) => {
    set({ isPlanning: true, error: null });
    try {
      const plan = await invoke<SyncPlan>('sftp_sync_plan', {
        sessionId: input.sessionId,
        localPath: input.localPath,
        remotePath: input.remotePath,
        direction: input.direction,
        conflictPolicy: input.conflictPolicy,
        deleteTargetOnly: input.deleteTargetOnly,
      });
      set({ plan, isPlanning: false });
      return plan;
    } catch (error) {
      set({ error: String(error), isPlanning: false });
      return null;
    }
  },

  apply: async (sessionId, plan) => {
    set({ isApplying: true, error: null });
    try {
      const result = await invoke<SyncApplyResult>('sftp_sync_apply', {
        sessionId,
        plan,
      });
      set({ lastResult: result, isApplying: false });
      return result;
    } catch (error) {
      set({ error: String(error), isApplying: false });
      return null;
    }
  },

  clear: () => {
    set({ plan: null, error: null, lastResult: null, isPlanning: false, isApplying: false });
  },
}));
