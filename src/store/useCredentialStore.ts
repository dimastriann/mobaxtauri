import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';

interface CredentialState {
  isUnlocked: boolean;
  isLoading: boolean;
  error: string | null;
  /** True when the backend needs the vault master password. */
  requiresMasterPassword: boolean;

  unlock: (masterPassword?: string) => Promise<boolean>;
  saveCredential: (sessionId: string, secret: string, masterPassword?: string) => Promise<void>;
  deleteCredential: (sessionId: string, masterPassword?: string) => Promise<void>;
}

/** Backend sentinel: the vault needs a master password to derive its key. */
export const VAULT_MASTER_PASSWORD_REQUIRED = 'VAULT MASTER PASSWORD REQUIRED';

const UNLOCK_TIMEOUT_MS = 120000;
let unlockPromise: Promise<boolean> | null = null;

export const useCredentialStore = create<CredentialState>((set, get) => ({
  isUnlocked: false,
  isLoading: false,
  error: null,
  requiresMasterPassword: false,

  unlock: async (masterPassword) => {
    if (get().isUnlocked) return true;

    if (!unlockPromise) {
      set({ isLoading: true, error: null });
      unlockPromise = invoke('credential_unlock', { masterPassword: masterPassword ?? null })
        .then(() => {
          set({
            isUnlocked: true,
            isLoading: false,
            error: null,
            requiresMasterPassword: false,
          });
          return true;
        })
        .catch((error: unknown) => {
          const message = String(error);
          set({
            isUnlocked: false,
            isLoading: false,
            error: message,
            requiresMasterPassword: message.includes(VAULT_MASTER_PASSWORD_REQUIRED),
          });
          return false;
        })
        .finally(() => {
          unlockPromise = null;
        });
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), UNLOCK_TIMEOUT_MS);
    });
    const result = await Promise.race([unlockPromise, timedOut]);
    if (timer) clearTimeout(timer);

    if (result === 'timeout') {
      set({
        isLoading: false,
        error: 'Credential vault is taking too long to unlock. Please try again.',
      });
      return false;
    }
    return result;
  },

  saveCredential: async (sessionId, secret, masterPassword) => {
    if (!(await get().unlock(masterPassword))) {
      throw new Error(get().error || 'Credential store is locked.');
    }
    await invoke('credential_save', { sessionId, secret });
  },

  deleteCredential: async (sessionId, masterPassword) => {
    if (!(await get().unlock(masterPassword))) {
      throw new Error(get().error || 'Credential store is locked.');
    }
    await invoke('credential_delete', { sessionId });
  },
}));
