import { describe, it, expect } from 'vitest';
import { parseSSHConfig, parseMobaXtermINI } from './importParsers';

describe('importParsers', () => {
  describe('parseSSHConfig', () => {
    it('should parse valid SSH config correct details', () => {
      const config = `
# This is a comment
Host production-server
  HostName 10.0.0.5
  User deploy
  Port 2222
  IdentityFile ~/.ssh/prod_id_rsa

Host staging-server
  HostName 10.0.0.10
  User ubuntu
      `;

      const sessions = parseSSHConfig(config);
      expect(sessions.length).toBe(2);

      expect(sessions[0].name).toBe('production-server');
      expect(sessions[0].host).toBe('10.0.0.5');
      expect(sessions[0].user).toBe('deploy');
      expect(sessions[0].port).toBe(2222);
      expect(sessions[0].privateKeyPath).toBe('~/.ssh/prod_id_rsa');

      expect(sessions[1].name).toBe('staging-server');
      expect(sessions[1].host).toBe('10.0.0.10');
      expect(sessions[1].user).toBe('ubuntu');
      expect(sessions[1].port).toBe(22); // Default port
      expect(sessions[1].privateKeyPath).toBeUndefined();
    });
  });

  describe('parseMobaXtermINI', () => {
    it('should parse MobaXterm INI format bookmark files', () => {
      const ini = `
[Bookmarks]
SubRep=
ImgNum=41
My Server 1= #109#0%myserver.com%22%root%%-1%-1%%%22%%0%0%0%%%-1%0%0%0%%1080%%0%0%0

[Bookmarks_Production]
SubRep=Production
ImgNum=42
My Server 2= #109#0%prodserver.com%2222%ubuntu%%-1%-1%%%22%%0%0%0%%%-1%0%0%0%%1080%%0%0%0
      `;

      const result = parseMobaXtermINI(ini);
      expect(result.folders.length).toBe(1);
      expect(result.folders[0].name).toBe('Production');

      expect(result.sessions.length).toBe(2);
      expect(result.sessions[0].name).toBe('My Server 1');
      expect(result.sessions[0].host).toBe('myserver.com');
      expect(result.sessions[0].port).toBe(22);
      expect(result.sessions[0].user).toBe('root');
      expect(result.sessions[0].folderId).toBeNull();

      expect(result.sessions[1].name).toBe('My Server 2');
      expect(result.sessions[1].host).toBe('prodserver.com');
      expect(result.sessions[1].port).toBe(2222);
      expect(result.sessions[1].user).toBe('ubuntu');
      expect(result.sessions[1].folderId).toBe(result.folders[0].id);
    });
  });
});
