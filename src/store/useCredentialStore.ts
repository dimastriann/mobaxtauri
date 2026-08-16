import { create } from 'zustand';
import { Stronghold } from '@tauri-apps/plugin-stronghold';
import { appDataDir, join } from '@tauri-apps/api/path';

interface CredentialState {
  stronghold: any | null;
  store: any | null;
  isUnlocked: boolean;
  isLoading: boolean;
  error: string | null;

  unlock: (password?: string) => Promise<boolean>;
  saveCredential: (sessionId: string, secret: string) => Promise<void>;
  getCredential: (sessionId: string) => Promise<string | null>;
  deleteCredential: (sessionId: string) => Promise<void>;
}

// v1 used synchronous Argon2 with a hardcoded password and could block the
// native Stronghold initialize command indefinitely in Windows debug builds.
// The versioned snapshot preserves the old file while using the plugin's fast
// fixed application-key branch (an empty password) for the replacement vault.
const VAULT_FILE = 'mobaxtauri-v2.hold';
const DEFAULT_KEY = '';
const CLIENT_NAME = 'mobaxtauri_client';
const CLIENT_READY_KEY = 'credential-v2-client-ready';
const UNLOCK_TIMEOUT_MS = 30000;
let unlockPromise: Promise<boolean> | null = null;

export const useCredentialStore = create<CredentialState>((set, get) => ({
  stronghold: null,
  store: null,
  isUnlocked: false,
  isLoading: false,
  error: null,

  unlock: async (password = DEFAULT_KEY) => {
    if (get().isUnlocked && get().store) return true;

    if (!unlockPromise) {
      set({ isLoading: true, error: null });
      unlockPromise = (async () => {
        try {
          const appData = await appDataDir();
          const vaultPath = await join(appData, VAULT_FILE);
          console.log('[CREDENTIALS] Loading Stronghold vault at:', vaultPath);
          const strongholdInstance = await Stronghold.load(vaultPath, password);

          let client;
          if (localStorage.getItem(CLIENT_READY_KEY) === 'true') {
            try {
              client = await strongholdInstance.loadClient(CLIENT_NAME);
            } catch {
              client = await strongholdInstance.createClient(CLIENT_NAME);
            }
          } else {
            try {
              // Creating first avoids a Stronghold 2.3.1 Windows hang when
              // load_client is called for a client that does not exist yet.
              client = await strongholdInstance.createClient(CLIENT_NAME);
            } catch {
              client = await strongholdInstance.loadClient(CLIENT_NAME);
            }
          }
          localStorage.setItem(CLIENT_READY_KEY, 'true');
          const storeInstance = client.getStore();
          set({
            stronghold: strongholdInstance,
            store: storeInstance,
            isUnlocked: true,
            isLoading: false,
            error: null,
          });
          console.log('[CREDENTIALS] Stronghold vault successfully unlocked');
          return true;
        } catch (err) {
          const message = String(err);
          console.error('[CREDENTIALS] Failed to unlock Stronghold vault:', err);
          set({ isLoading: false, error: message });
          return false;
        } finally {
          unlockPromise = null;
        }
      })();
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

  saveCredential: async (sessionId: string, secret: string) => {
    const { store, stronghold, isUnlocked } = get();
    if (!isUnlocked || !store) {
      // Try to transparently unlock first
      const success = await get().unlock();
      if (!success) {
        throw new Error(get().error || 'Credential store is locked.');
      }
    }

    const activeStore = store || get().store;
    const activeStronghold = stronghold || get().stronghold;

    try {
      const data = new TextEncoder().encode(secret);
      await activeStore.insert(sessionId, Array.from(data));
      await activeStronghold.save();
      console.log(`[CREDENTIALS] Saved credential for session: ${sessionId}`);
    } catch (err) {
      console.error(`[CREDENTIALS] Failed to save credential for session ${sessionId}:`, err);
      throw err;
    }
  },

  getCredential: async (sessionId: string) => {
    const { store, isUnlocked } = get();
    if (!isUnlocked || !store) {
      const success = await get().unlock();
      if (!success) return null;
    }

    const activeStore = store || get().store;

    try {
      const data = await activeStore.get(sessionId);
      if (!data || data.length === 0) return null;

      const secret = new TextDecoder().decode(new Uint8Array(data));
      return secret;
    } catch (err) {
      console.error(`[CREDENTIALS] Failed to get credential for session ${sessionId}:`, err);
      return null;
    }
  },

  deleteCredential: async (sessionId: string) => {
    const { store, stronghold, isUnlocked } = get();
    if (!isUnlocked || !store) {
      const success = await get().unlock();
      if (!success) {
        throw new Error(get().error || 'Credential store is locked.');
      }
    }

    const activeStore = store || get().store;
    const activeStronghold = stronghold || get().stronghold;

    try {
      await activeStore.remove(sessionId);
      await activeStronghold.save();
      console.log(`[CREDENTIALS] Deleted credential for session: ${sessionId}`);
    } catch (err) {
      console.warn(`[CREDENTIALS] Failed to delete credential for session ${sessionId}:`, err);
    }
  },
}));
