import { Session, Folder } from '../store/useSessionStore';

/**
 * Parses ~/.ssh/config text format.
 */
export function parseSSHConfig(content: string): Session[] {
  const sessions: Session[] = [];
  const lines = content.split(/\r?\n/);

  let currentSession: Partial<Session> | null = null;

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;

    // Check for "Host <alias>"
    const hostMatch = line.match(/^Host\s+(.+)$/i);
    if (hostMatch) {
      if (currentSession && currentSession.host && currentSession.user) {
        sessions.push(createSessionFromPartial(currentSession));
      }
      currentSession = {
        id: `ssh-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'ssh',
        name: hostMatch[1].trim(),
        port: 22,
        status: 'disconnected',
      };
      continue;
    }

    if (!currentSession) continue;

    // Parse HostName
    const hostNameMatch = line.match(/^HostName\s+(.+)$/i);
    if (hostNameMatch) {
      currentSession.host = hostNameMatch[1].trim();
      continue;
    }

    // Parse User
    const userMatch = line.match(/^User\s+(.+)$/i);
    if (userMatch) {
      currentSession.user = userMatch[1].trim();
      continue;
    }

    // Parse Port
    const portMatch = line.match(/^Port\s+(\d+)$/i);
    if (portMatch) {
      currentSession.port = parseInt(portMatch[1].trim(), 10);
      continue;
    }

    // Parse IdentityFile
    const identityMatch = line.match(/^IdentityFile\s+(.+)$/i);
    if (identityMatch) {
      currentSession.privateKeyPath = identityMatch[1].trim();
      continue;
    }
  }

  if (currentSession && currentSession.host && currentSession.user) {
    sessions.push(createSessionFromPartial(currentSession));
  }

  return sessions;
}

function createSessionFromPartial(partial: Partial<Session>): Session {
  return {
    id: partial.id || `ssh-${Date.now()}`,
    name: partial.name || `${partial.user}@${partial.host}`,
    type: 'ssh',
    host: partial.host || '',
    user: partial.user || '',
    port: partial.port || 22,
    status: 'disconnected',
    privateKeyPath: partial.privateKeyPath,
    folderId: partial.folderId || null,
  };
}

/**
 * Parses MobaXterm.ini style bookmark files.
 */
export function parseMobaXtermINI(content: string): { sessions: Session[]; folders: Folder[] } {
  const sessions: Session[] = [];
  const folders: Folder[] = [];
  const lines = content.split(/\r?\n/);

  let currentFolderId: string | null = null;

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;

    // Check for Section headers indicating folders
    const sectionMatch = line.match(/^\[(.*)\]$/);
    if (sectionMatch) {
      const sectionName = sectionMatch[1].trim();
      if (sectionName.toLowerCase() === 'bookmarks') {
        currentFolderId = null;
      } else if (sectionName.toLowerCase().startsWith('bookmarks_')) {
        const folderName = sectionName.substring(10);
        const folderId = `folder-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        folders.push({
          id: folderId,
          name: folderName,
          isCollapsed: false,
        });
        currentFolderId = folderId;
      }
      continue;
    }

    // Check for bookmark session line: Key=Value
    const equalIdx = line.indexOf('=');
    if (equalIdx <= 0) continue;

    const key = line.substring(0, equalIdx).trim();
    const val = line.substring(equalIdx + 1).trim();

    if (key.toLowerCase() === 'subrep' || key.toLowerCase() === 'imgnum') continue;

    // SSH session starts with #109#
    if (val.startsWith('#109#')) {
      const parts = val.substring(5).split('%');
      if (parts.length > 3) {
        const host = parts[1];
        const portVal = parseInt(parts[2], 10);
        const port = isNaN(portVal) ? 22 : portVal;
        const user = parts[3];

        sessions.push({
          id: `ssh-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: key,
          type: 'ssh',
          host,
          user,
          port,
          status: 'disconnected',
          folderId: currentFolderId,
        });
      }
    }
  }

  return { sessions, folders };
}
