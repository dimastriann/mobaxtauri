import { create } from 'zustand';
import { Stronghold } from '@tauri-apps/plugin-stronghold';
import { appDataDir, join } from '@tauri-apps/api/path';

interface CredentialState {
  stronghold: any | null;
  store: any | null;
  isUnlocked: boolean;
  isLoading: boolean;

  unlock: (password?: string) => Promise<boolean>;
  saveCredential: (sessionId: string, secret: string) => Promise<void>;
  getCredential: (sessionId: string) => Promise<string | null>;
  deleteCredential: (sessionId: string) => Promise<void>;
}

const VAULT_FILE = 'mobaxtauri.hold';
const DEFAULT_KEY = 'mobaxtauri_default_secure_key_12345';
const CLIENT_NAME = 'mobaxtauri_client';

export const useCredentialStore = create<CredentialState>((set, get) => ({
  stronghold: null,
  store: null,
  isUnlocked: false,
  isLoading: false,

  unlock: async (password = DEFAULT_KEY) => {
    try {
      set({ isLoading: true });
      const appData = await appDataDir();
      const vaultPath = await join(appData, VAULT_FILE);

      console.log('[CREDENTIALS] Loading Stronghold vault at:', vaultPath);
      const strongholdInstance = await Stronghold.load(vaultPath, password);

      let client;
      try {
        client = await strongholdInstance.loadClient(CLIENT_NAME);
      } catch (err) {
        console.log('[CREDENTIALS] Client not found, creating new client...');
        client = await strongholdInstance.createClient(CLIENT_NAME);
      }

      const storeInstance = client.getStore();

      set({
        stronghold: strongholdInstance,
        store: storeInstance,
        isUnlocked: true,
        isLoading: false,
      });

      console.log('[CREDENTIALS] Stronghold vault successfully unlocked');
      return true;
    } catch (err) {
      console.error('[CREDENTIALS] Failed to unlock Stronghold vault:', err);
      set({ isLoading: false });
      return false;
    }
  },

  saveCredential: async (sessionId: string, secret: string) => {
    const { store, stronghold, isUnlocked } = get();
    if (!isUnlocked || !store) {
      // Try to transparently unlock first
      const success = await get().unlock();
      if (!success) {
        throw new Error('Credential store is locked.');
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
      if (!success) return;
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
