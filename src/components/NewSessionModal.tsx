import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { Stack, Input, Button, HStack } from '@chakra-ui/react';
import { Session, useSessionStore } from '../store/useSessionStore';
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
  const [port, setPort] = useState(22);
  const [name, setName] = useState('');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [tag, setTag] = useState<'prod' | 'staging' | 'dev' | 'custom' | undefined>(undefined);
  const [isConnecting, setIsConnecting] = useState(false);

  const folders = useSessionStore((state) => state.folders);
  const addSession = useSessionStore((state) => state.addSession);
  const updateSession = useSessionStore((state) => state.updateSession);
  const updateStatus = useSessionStore((state) => state.updateSessionStatus);

  useEffect(() => {
    if (editingSession) {
      setHost(editingSession.host || '');
      setUser(editingSession.user || '');
      setPassword(editingSession.password || '');
      setPort(editingSession.port || 22);
      setName(editingSession.name);
      setFolderId(editingSession.folderId || null);
      setTag(editingSession.tag);
      setUsePrivateKey(!!editingSession.privateKeyPath);
      setPrivateKeyPath(editingSession.privateKeyPath || '');
    } else {
      setHost('');
      setUser('');
      setPassword('');
      setPort(22);
      setName('');
      setFolderId(null);
      setTag(undefined);
      setUsePrivateKey(false);
      setPrivateKeyPath('');
    }
  }, [editingSession, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (editingSession) {
      updateSession(editingSession.id, {
        name: name || `${user}@${host}`,
        host,
        user,
        port,
        password: password || undefined,
        status: 'disconnected',
        folderId,
        tag,
        privateKeyPath: usePrivateKey && privateKeyPath ? privateKeyPath : undefined,
      });
      onClose();
      return;
    }

    setIsConnecting(true);
    const sessionId = `ssh-${Date.now()}`;
    addSession({
      id: sessionId,
      name: name || `${user}@${host}`,
      type: 'ssh',
      host,
      user,
      port,
      password: password || undefined,
      status: 'connecting',
      folderId,
      tag,
      privateKeyPath: usePrivateKey && privateKeyPath ? privateKeyPath : undefined,
    });

    try {
      await invoke('ssh_connect', {
        sessionId,
        host,
        port,
        user,
        password: password || null,
        privateKeyPath: usePrivateKey && privateKeyPath ? privateKeyPath : null,
      });
      updateStatus(sessionId, 'connected');
      onClose();
    } catch (err) {
      console.error('SSH Connection failed:', err);
      updateStatus(sessionId, 'error', String(err));
      // Keep modal open or show error? Usually onClose() then user sees red dot.
      onClose();
    } finally {
      setIsConnecting(false);
    }
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
                <Field label="Password (Optional)" helperText="Leave empty for keys">
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    size="sm"
                  />
                </Field>
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
