import React, { useEffect, useState } from 'react';
import { Button, Flex, HStack, Text } from '@chakra-ui/react';
import { ask } from '@tauri-apps/plugin-dialog';
import FilePane, { type PaneEntry } from './FilePane';
import TransferQueue from './TransferQueue';
import { useSftpStore } from '../store/useSftpStore';
import { useLocalFilesStore } from '../store/useLocalFilesStore';
import { useSessionStore } from '../store/useSessionStore';
import { useTranslation } from '../store/useLocaleStore';
import { joinLocalPath } from '../utils/localPath';
import PromptModal from './PromptModal';
import { toaster } from './ui/toaster';

const LOCAL_DRAG_MIME = 'application/x-mobaxtauri-local';
const REMOTE_DRAG_MIME = 'application/x-mobaxtauri-remote';

const joinRemotePath = (base: string, name: string): string =>
  base.endsWith('/') ? `${base}${name}` : `${base}/${name}`;

const SftpWorkspace: React.FC = () => {
  const { t } = useTranslation();
  const sessions = useSessionStore((state) => state.sessions);
  const openTabs = useSessionStore((state) => state.openTabs);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const setActiveSession = useSessionStore((state) => state.setActiveSession);

  const remotePath = useSftpStore((state) => state.currentPath);
  const remoteFiles = useSftpStore((state) => state.files);
  const remoteLoading = useSftpStore((state) => state.isLoading);
  const remoteError = useSftpStore((state) => state.error);
  const fetchRemote = useSftpStore((state) => state.fetchDirectory);
  const cdRemote = useSftpStore((state) => state.cd);
  const openRemoteFile = useSftpStore((state) => state.openFile);

  const localPath = useLocalFilesStore((state) => state.currentPath);
  const localParent = useLocalFilesStore((state) => state.parent);
  const localEntries = useLocalFilesStore((state) => state.entries);
  const localLoading = useLocalFilesStore((state) => state.isLoading);
  const localError = useLocalFilesStore((state) => state.error);
  const fetchLocal = useLocalFilesStore((state) => state.fetchDirectory);
  const cdLocal = useLocalFilesStore((state) => state.cd);
  const localUp = useLocalFilesStore((state) => state.cdUp);
  const refreshLocal = useLocalFilesStore((state) => state.refresh);
  const createLocalDir = useLocalFilesStore((state) => state.createDir);
  const renameLocalEntry = useLocalFilesStore((state) => state.rename);
  const removeLocalEntries = useLocalFilesStore((state) => state.removeMany);

  const [localPrompt, setLocalPrompt] = useState<
    { kind: 'new-folder' } | { kind: 'rename'; entry: PaneEntry } | null
  >(null);

  const sshSessions = openTabs
    .map((id) => sessions.find((session) => session.id === id))
    .filter((session): session is NonNullable<typeof session> => session?.type === 'ssh');
  const activeSession = sshSessions.find((session) => session.id === activeSessionId) ?? null;
  const activeFileSessionId = activeSession?.id ?? null;

  useEffect(() => {
    void fetchLocal();
  }, [fetchLocal]);

  useEffect(() => {
    if (!activeFileSessionId) return;
    useSftpStore.getState().reset();
    void fetchRemote(activeFileSessionId, '/');
  }, [activeFileSessionId, fetchRemote]);

  const localPaneEntries: PaneEntry[] = localEntries.map((entry) => ({
    key: entry.path,
    name: entry.name,
    path: entry.path,
    isDir: entry.isDir,
    isFile: entry.isFile,
    isSymlink: entry.isSymlink,
    size: entry.size,
    modified: entry.modified,
  }));

  const remotePaneEntries: PaneEntry[] = remoteFiles.map((file) => ({
    key: file.name,
    name: file.name,
    path: joinRemotePath(remotePath, file.name),
    isDir: file.is_dir,
    isFile: file.is_file,
    size: file.size,
    modified: file.modified,
    permissions: file.permissions,
  }));

  const uploadLocalEntries = async (entries: PaneEntry[]) => {
    if (!activeSession || entries.length === 0) return;
    await useSftpStore.getState().uploadPaths(
      activeSession.id,
      entries.map((entry) => entry.path),
    );
  };

  const downloadRemoteEntries = async (entries: PaneEntry[]) => {
    if (!activeSession || !localPath || entries.length === 0) return;
    const result = await useSftpStore.getState().downloadEntriesTo(
      activeSession.id,
      entries.map((entry) => ({ name: entry.name, isDir: entry.isDir })),
      localPath,
    );
    await refreshLocal();
    if (result.failures.length > 0) {
      toaster.create({
        title: t('files.transferFailed'),
        description: result.failures
          .slice(0, 3)
          .map((failure) => `${failure.name}: ${failure.message}`)
          .join('\n'),
        type: 'error',
      });
    }
  };

  const deleteLocalEntries = async (entries: PaneEntry[]) => {
    if (entries.length === 0) return;
    const confirmed = await ask(t('files.deleteConfirm', { count: entries.length }), {
      title: t('files.deleteTitle'),
      kind: 'warning',
      okLabel: t('files.delete'),
      cancelLabel: t('common.cancel'),
    });
    if (!confirmed) return;
    try {
      const result = await removeLocalEntries(
        entries.map((entry) => ({ path: entry.path, recursive: entry.isDir })),
      );
      if (result.failures.length > 0) {
        toaster.create({
          title: t('files.deleteFailed'),
          description: result.failures
            .slice(0, 3)
            .map((failure) => `${failure.path}: ${failure.message}`)
            .join('\n'),
          type: 'error',
        });
      } else {
        toaster.create({
          title: t('files.deleted', { count: result.removed.length }),
          type: 'success',
        });
      }
    } catch (error) {
      toaster.create({
        title: t('files.operationFailed'),
        description: String(error),
        type: 'error',
      });
    }
  };

  const confirmLocalPrompt = async (values: Record<string, string>) => {
    const prompt = localPrompt;
    const name = values.name?.trim();
    setLocalPrompt(null);
    if (!prompt || !name) return;
    try {
      if (prompt.kind === 'new-folder') {
        if (!localPath) return;
        await createLocalDir(joinLocalPath(localPath, name));
      } else {
        const entry = prompt.entry;
        const separatorIndex = Math.max(entry.path.lastIndexOf('/'), entry.path.lastIndexOf('\\'));
        const parent = separatorIndex >= 0 ? entry.path.slice(0, separatorIndex + 1) : '';
        await renameLocalEntry(entry.path, `${parent}${name}`);
      }
    } catch (error) {
      toaster.create({
        title: t('files.operationFailed'),
        description: String(error),
        type: 'error',
      });
    }
  };

  return (
    <Flex direction="column" flex={1} minH={0} bg="bg.panel" overflow="hidden">
      <HStack
        px={4}
        py={2}
        justify="space-between"
        borderBottom="1px solid"
        borderColor="border.subtle"
        bg="bg.muted"
      >
        <HStack gap={3}>
          <Text fontSize="14px" fontWeight="bold" color="fg">
            {t('files.title')}
          </Text>
          <select
            aria-label={t('files.session')}
            value={activeSession?.id ?? ''}
            onChange={(event) => {
              if (event.target.value) setActiveSession(event.target.value);
            }}
            disabled={sshSessions.length === 0}
            style={{
              width: 220,
              height: 26,
              background: 'transparent',
              border: '1px solid var(--chakra-colors-border-subtle)',
              borderRadius: 4,
              padding: '0 6px',
              fontSize: 12,
              color: 'inherit',
            }}
          >
            <option value="" style={{ background: 'var(--chakra-colors-bg-panel)' }}>
              {t('files.chooseSession')}
            </option>
            {sshSessions.map((session) => (
              <option
                key={session.id}
                value={session.id}
                style={{ background: 'var(--chakra-colors-bg-panel)' }}
              >
                {session.name}
              </option>
            ))}
          </select>
        </HStack>
      </HStack>

      <TransferQueue maxHeight="150px" />

      {!activeSession ? (
        <Flex flex={1} align="center" justify="center" direction="column" gap={2}>
          <Text fontSize="13px" color="fg.muted">
            {t('files.chooseSession')}
          </Text>
          <Text fontSize="11px" color="fg.subtle">
            {t('files.chooseSessionHint')}
          </Text>
        </Flex>
      ) : activeSession.status !== 'connected' ? (
        <Flex flex={1} align="center" justify="center" direction="column" gap={2}>
          <Text fontSize="13px" color="red.fg">
            {t('files.sessionNotConnected')}
          </Text>
          <Text fontSize="11px" color="fg.subtle">
            {t('files.sessionNotConnectedHint')}
          </Text>
        </Flex>
      ) : (
        <Flex flex={1} minH={0} gap="1px" bg="border.subtle">
          <FilePane
            key={`local-${localPath ?? 'home'}`}
            title={t('files.local')}
            path={localPath}
            parent={localParent}
            entries={localPaneEntries}
            isLoading={localLoading}
            error={localError}
            emptyLabel={t('files.empty')}
            pathPlaceholder={t('files.pathPlaceholder')}
            upLabel={t('files.up')}
            refreshLabel={t('files.refresh')}
            onOpen={(entry) => {
              if (entry.isDir) void cdLocal(entry.path);
            }}
            onUp={() => void localUp()}
            onRefresh={() => void refreshLocal()}
            onPathSubmit={(path) => {
              if (path) void cdLocal(path);
            }}
            dragMime={LOCAL_DRAG_MIME}
            acceptMime={REMOTE_DRAG_MIME}
            onDropEntries={(entries) => void downloadRemoteEntries(entries)}
            toolbar={
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setLocalPrompt({ kind: 'new-folder' })}
              >
                {t('files.newFolder')}
              </Button>
            }
            actions={(selected) => (
              <>
                <Button
                  size="xs"
                  variant="subtle"
                  colorPalette="blue"
                  onClick={() => void uploadLocalEntries(selected)}
                >
                  {t('files.uploadSelected', { count: selected.length })}
                </Button>
                {selected.length === 1 && (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setLocalPrompt({ kind: 'rename', entry: selected[0] })}
                  >
                    {t('files.rename')}
                  </Button>
                )}
                <Button
                  size="xs"
                  variant="ghost"
                  colorPalette="red"
                  onClick={() => void deleteLocalEntries(selected)}
                >
                  {t('files.delete')}
                </Button>
              </>
            )}
          />
          <FilePane
            key={`remote-${activeSession.id}-${remotePath}`}
            title={t('files.remote')}
            path={remotePath}
            parent={remotePath === '/' ? null : remotePath.replace(/\/[^/]+\/?$/, '') || '/'}
            entries={remotePaneEntries}
            isLoading={remoteLoading}
            error={remoteError}
            emptyLabel={t('files.empty')}
            pathPlaceholder={t('files.pathPlaceholder')}
            upLabel={t('files.up')}
            refreshLabel={t('files.refresh')}
            onOpen={(entry) => {
              if (entry.isDir) void cdRemote(activeSession.id, entry.path);
              else void openRemoteFile(activeSession.id, entry.path);
            }}
            onUp={() => void cdRemote(activeSession.id, '..')}
            onRefresh={() => void fetchRemote(activeSession.id)}
            onPathSubmit={(path) => {
              if (path) void fetchRemote(activeSession.id, path);
            }}
            dragMime={REMOTE_DRAG_MIME}
            acceptMime={LOCAL_DRAG_MIME}
            onDropEntries={(entries) => void uploadLocalEntries(entries)}
            actions={(selected) => (
              <Button
                size="xs"
                variant="subtle"
                colorPalette="blue"
                onClick={() => void downloadRemoteEntries(selected)}
              >
                {t('files.downloadSelected', { count: selected.length })}
              </Button>
            )}
          />
        </Flex>
      )}

      <PromptModal
        isOpen={localPrompt !== null}
        title={localPrompt?.kind === 'rename' ? t('files.renameTitle') : t('files.newFolderTitle')}
        fields={[
          {
            key: 'name',
            label: t('files.name'),
            placeholder:
              localPrompt?.kind === 'rename' ? localPrompt.entry.name : t('files.namePlaceholder'),
          },
        ]}
        onConfirm={(values) => void confirmLocalPrompt(values)}
        onClose={() => setLocalPrompt(null)}
      />
    </Flex>
  );
};

export default SftpWorkspace;
