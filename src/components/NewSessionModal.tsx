import React, { useState, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { Stack, Input, Button, HStack, Text } from '@chakra-ui/react';
import { Session, useSessionStore } from '../store/useSessionStore';
import { useCredentialStore } from '../store/useCredentialStore';
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogCloseTrigger,
} from './ui/dialog';
import { Field } from './ui/field';

interface NewSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingSession?: Session;
}

const NewSessionModal: React.FC<NewSessionModalProps> = ({ isOpen, onClose, editingSession }) => {
  const [host, setHost] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [usePrivateKey, setUsePrivateKey] = useState(false);
  const [privateKeyPath, setPrivateKeyPath] = useState('');
  const [port, setPort] = useState(() => {
    const saved = localStorage.getItem('ssh-default-port');
    return saved ? parseInt(saved, 10) : 22;
  });
  const [name, setName] = useState('');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [tag, setTag] = useState<'prod' | 'staging' | 'dev' | 'custom' | undefined>(undefined);
  const [savePassword, setSavePassword] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const folders = useSessionStore((state) => state.folders);
  const addSession = useSessionStore((state) => state.addSession);
  const updateSession = useSessionStore((state) => state.updateSession);

  useEffect(() => {
    setSaveError(null);
    if (editingSession) {
      setHost(editingSession.host || '');
      setUser(editingSession.user || '');
      setPort(
        editingSession.port || parseInt(localStorage.getItem('ssh-default-port') || '22', 10),
      );
      setName(editingSession.name);
      setFolderId(editingSession.folderId || null);
      setTag(editingSession.tag);
      setUsePrivateKey(!!editingSession.privateKeyPath);
      setPrivateKeyPath(editingSession.privateKeyPath || '');
      setSavePassword(editingSession.savePassword ?? true);
      setPassword('');
    } else {
      setHost('');
      setUser('');
      setPassword('');
      setPort(parseInt(localStorage.getItem('ssh-default-port') || '22', 10));
      setName('');
      setFolderId(null);
      setTag(undefined);
      setUsePrivateKey(false);
      setPrivateKeyPath('');
      setSavePassword(true);
    }
  }, [editingSession, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsConnecting(true);
    setSaveError(null);

    if (editingSession) {
      let credentialError: string | null = null;
      const shouldSavePassword = savePassword && Boolean(password || editingSession.savePassword);
      try {
        if (savePassword && password) {
          await useCredentialStore.getState().saveCredential(editingSession.id, password);
        } else if (!savePassword) {
          await useCredentialStore.getState().deleteCredential(editingSession.id);
        }
      } catch (error) {
        credentialError = String(error);
      }

      updateSession(editingSession.id, {
        name: name || `${user}@${host}`,
        host,
        user,
        port,
        status: 'disconnected',
        folderId,
        tag,
        privateKeyPath: usePrivateKey && privateKeyPath ? privateKeyPath : undefined,
        savePassword: shouldSavePassword,
      });
      setIsConnecting(false);
      if (credentialError) {
        setSaveError(`Session details were saved, but the vault failed: ${credentialError}`);
      } else {
        onClose();
      }
      return;
    }

    const sessionId = `ssh-${Date.now()}`;
    const shouldSavePassword = savePassword && Boolean(password);

    if (shouldSavePassword) {
      try {
        await useCredentialStore.getState().saveCredential(sessionId, password);
      } catch (error) {
        setSaveError(
          `Password was not saved: ${String(error)}. Retry or disable vault password saving.`,
        );
        setIsConnecting(false);
        return;
      }
    }

    addSession({
      id: sessionId,
      name: name || `${user}@${host}`,
      type: 'ssh',
      host,
      user,
      port,
      status: 'connecting',
      folderId,
      tag,
      privateKeyPath: usePrivateKey && privateKeyPath ? privateKeyPath : undefined,
      savePassword: shouldSavePassword,
      // Memory-only when the user declined vault saving (persisted stores
      // strip the password field); lets the terminal's own connect use it.
      password: shouldSavePassword ? undefined : password || undefined,
    });

    // The terminal tab owns the connect attempt: it registers its IPC
    // listeners before dialing, so host-key prompts and auth failures are
    // never raced by this modal's own direct ssh_connect (which used to
    // double-connect and lose first-connect host-key prompts).
    setIsConnecting(false);
    onClose();
  };

  return (
    <DialogRoot
      open={isOpen}
      onOpenChange={(e) => !e.open && onClose()}
      size="sm"
      placement="center"
    >
      <DialogContent bg="bg.panel" borderColor="border.subtle">
        <DialogHeader>
          <DialogTitle color="fg.default">
            {editingSession ? 'Edit SSH Session' : 'New SSH Session'}
          </DialogTitle>
        </DialogHeader>

        <DialogBody pb={6}>
          <form id="session-form" onSubmit={handleSubmit}>
            <Stack gap={4}>
              {saveError && (
                <Text fontSize="12px" color="red.fg" bg="red.subtle" p={2} borderRadius="md">
                  {saveError}
                </Text>
              )}
              <Field label="Session Name (Optional)">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Display Name"
                  size="sm"
                />
              </Field>

              <Field label="Folder">
                <select
                  value={folderId || ''}
                  onChange={(e) => setFolderId(e.target.value || null)}
                  style={{
                    width: '100%',
                    height: '32px',
                    backgroundColor: 'transparent',
                    border: '1px solid',
                    borderColor: 'var(--chakra-colors-border-subtle)',
                    borderRadius: '4px',
                    padding: '0 8px',
                    fontSize: '14px',
                    color: 'inherit',
                    outline: 'none',
                  }}
                >
                  <option value="" style={{ background: 'var(--chakra-colors-bg-panel)' }}>
                    Uncategorized
                  </option>
                  {folders.map((f) => (
                    <option
                      key={f.id}
                      value={f.id}
                      style={{ background: 'var(--chakra-colors-bg-panel)' }}
                    >
                      {f.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Tag">
                <select
                  value={tag || ''}
                  onChange={(e) => setTag((e.target.value as any) || undefined)}
                  style={{
                    width: '100%',
                    height: '32px',
                    backgroundColor: 'transparent',
                    border: '1px solid',
                    borderColor: 'var(--chakra-colors-border-subtle)',
                    borderRadius: '4px',
                    padding: '0 8px',
                    fontSize: '14px',
                    color: 'inherit',
                    outline: 'none',
                  }}
                >
                  <option value="" style={{ background: 'var(--chakra-colors-bg-panel)' }}>
                    None
                  </option>
                  <option
                    value="prod"
                    style={{
                      background: 'var(--chakra-colors-bg-panel)',
                      color: 'var(--chakra-colors-red-400)',
                    }}
                  >
                    Production
                  </option>
                  <option
                    value="staging"
                    style={{
                      background: 'var(--chakra-colors-bg-panel)',
                      color: 'var(--chakra-colors-orange-400)',
                    }}
                  >
                    Staging
                  </option>
                  <option
                    value="dev"
                    style={{
                      background: 'var(--chakra-colors-bg-panel)',
                      color: 'var(--chakra-colors-green-400)',
                    }}
                  >
                    Development
                  </option>
                </select>
              </Field>

              <Field label="Remote Host" required>
                <Input
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="e.g. 192.168.1.10"
                  size="sm"
                  required
                />
              </Field>

              <HStack gap={4} align="flex-start">
                <Field label="Username" flex={1} required>
                  <Input
                    value={user}
                    onChange={(e) => setUser(e.target.value)}
                    placeholder="root"
                    size="sm"
                    required
                  />
                </Field>
                <Field label="Port" w="80px" required>
                  <Input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(parseInt(e.target.value))}
                    size="sm"
                    required
                  />
                </Field>
              </HStack>

              <HStack gap={2} mt={2}>
                <input
                  type="checkbox"
                  id="use-private-key"
                  checked={usePrivateKey}
                  onChange={(e) => setUsePrivateKey(e.target.checked)}
                />
                <label htmlFor="use-private-key" style={{ fontSize: '14px', cursor: 'pointer' }}>
                  Use SSH Private Key
                </label>
              </HStack>

              {usePrivateKey ? (
                <Field label="Private Key Path" required>
                  <HStack w="full">
                    <Input
                      value={privateKeyPath}
                      onChange={(e) => setPrivateKeyPath(e.target.value)}
                      placeholder="/path/to/id_rsa"
                      size="sm"
                      flex={1}
                      required
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        const selected = await open({
                          multiple: false,
                          directory: false,
                        });
                        if (selected && typeof selected === 'string') {
                          setPrivateKeyPath(selected);
                        }
                      }}
                    >
                      Browse
                    </Button>
                  </HStack>
                </Field>
              ) : (
                <Stack gap={2}>
                  <Field
                    label="Password (Optional)"
                    helperText={
                      editingSession?.savePassword
                        ? 'Leave empty to keep the saved password'
                        : 'Leave empty for keys'
                    }
                  >
                    <Input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      size="sm"
                    />
                  </Field>
                  <HStack gap={2} mt={1}>
                    <input
                      type="checkbox"
                      id="save-password"
                      checked={savePassword}
                      onChange={(e) => setSavePassword(e.target.checked)}
                    />
                    <label
                      htmlFor="save-password"
                      style={{
                        fontSize: '13px',
                        cursor: 'pointer',
                        color: 'var(--chakra-colors-fg-muted)',
                      }}
                    >
                      Save Password Securely in Vault
                    </label>
                  </HStack>
                </Stack>
              )}
            </Stack>
          </form>
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isConnecting}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="session-form"
            colorPalette="blue"
            size="sm"
            loading={isConnecting}
          >
            {editingSession ? 'Save Changes' : 'Connect'}
          </Button>
        </DialogFooter>
        <DialogCloseTrigger />
      </DialogContent>
    </DialogRoot>
  );
};

export default NewSessionModal;
