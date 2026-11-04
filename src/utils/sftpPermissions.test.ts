import { describe, expect, it } from 'vitest';
import {
  formatOctalMode,
  modeToPermissions,
  parseOctalMode,
  permissionsToMode,
} from './sftpPermissions';

describe('sftp permission helpers', () => {
  it('converts a mode into checkbox state and back', () => {
    const checks = modeToPermissions(0o640);
    expect(checks.ownerRead).toBe(true);
    expect(checks.ownerWrite).toBe(true);
    expect(checks.ownerExecute).toBe(false);
    expect(checks.groupRead).toBe(true);
    expect(checks.groupWrite).toBe(false);
    expect(checks.otherRead).toBe(false);
    expect(permissionsToMode(checks)).toBe(0o640);
  });

  it('formats the UI octal value', () => {
    expect(formatOctalMode(0o644)).toBe('644');
    expect(formatOctalMode(0o0755)).toBe('755');
    expect(formatOctalMode(0o7777)).toBe('7777');
  });

  it('parses valid octal input and rejects bad values', () => {
    expect(parseOctalMode('640')).toBe(0o640);
    expect(parseOctalMode('0777')).toBe(0o777);
    expect(parseOctalMode('8')).toBeNull();
    expect(parseOctalMode('')).toBeNull();
    expect(parseOctalMode('10000')).toBeNull();
  });
});
