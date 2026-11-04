/** Join a local directory and an entry name, preserving the directory's
 * separator style (Windows \ or POSIX /). */
export const joinLocalPath = (directory: string, name: string): string => {
  const trimmed = directory.replace(/[\\/]+$/, '');
  const separator = trimmed.includes('\\') && !trimmed.includes('/') ? '\\' : '/';
  return `${trimmed}${separator}${name}`;
};
