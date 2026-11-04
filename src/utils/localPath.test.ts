import { describe, expect, it } from 'vitest';
import { joinLocalPath } from './localPath';

describe('joinLocalPath', () => {
  it('joins POSIX directories', () => {
    expect(joinLocalPath('/home/user', 'file.txt')).toBe('/home/user/file.txt');
    expect(joinLocalPath('/home/user/', 'file.txt')).toBe('/home/user/file.txt');
  });

  it('joins Windows directories', () => {
    expect(joinLocalPath('C:\\Users\\me', 'file.txt')).toBe('C:\\Users\\me\\file.txt');
    expect(joinLocalPath('C:\\Users\\me\\', 'file.txt')).toBe('C:\\Users\\me\\file.txt');
  });
});
