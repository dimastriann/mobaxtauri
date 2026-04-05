import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Stack, Input, Button, HStack } from "@chakra-ui/react";
import { Session, useSessionStore } from '../store/useSessionStore';
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogCloseTrigger,
} from "./ui/dialog";
import { Field } from "./ui/field";

interface NewSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingSession?: Session;
}

const NewSessionModal: React.FC<NewSessionModalProps> = ({ isOpen, onClose, editingSession }) => {
  const [host, setHost] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [port, setPort] = useState(22);
  const [name, setName] = useState('');
  const [folderId, setFolderId] = useState<string | null>(null);
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
    } else {
      setHost('');
      setUser('');
      setPassword('');
      setPort(22);
      setName('');
      setFolderId(null);
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
        folderId
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
      folderId
    });

    try {
      await invoke('ssh_connect', {
        sessionId,
        host,
        port,
        user,
        password: password || null
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
    <DialogRoot open={isOpen} onOpenChange={(e) => !e.open && onClose()} size="sm" placement="center">
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
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '4px',
                    padding: '0 8px',
                    fontSize: '14px',
                    color: 'white',
                    outline: 'none'
                  }}
                >
                  <option value="" style={{ background: '#1a1a1a' }}>Uncategorized</option>
                  {folders.map(f => (
                    <option key={f.id} value={f.id} style={{ background: '#1a1a1a' }}>
                      {f.name}
                    </option>
                  ))}
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

              <Field label="Password (Optional)" helperText="Leave empty for keys">
                <Input 
                  type="password" 
                  value={password} 
                  onChange={(e) => setPassword(e.target.value)} 
                  size="sm"
                />
              </Field>
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
