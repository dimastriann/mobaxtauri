export const PERMISSION_KEYS = [
  'ownerRead',
  'ownerWrite',
  'ownerExecute',
  'groupRead',
  'groupWrite',
  'groupExecute',
  'otherRead',
  'otherWrite',
  'otherExecute',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const PERMISSION_BITS: Record<PermissionKey, number> = {
  ownerRead: 0o400,
  ownerWrite: 0o200,
  ownerExecute: 0o100,
  groupRead: 0o040,
  groupWrite: 0o020,
  groupExecute: 0o010,
  otherRead: 0o004,
  otherWrite: 0o002,
  otherExecute: 0o001,
};

export type PermissionChecks = Record<PermissionKey, boolean>;

/** Access bits only; the backend preserves the file-type bits. */
export const permissionsToMode = (checks: PermissionChecks): number =>
  PERMISSION_KEYS.reduce((mode, key) => (checks[key] ? mode | PERMISSION_BITS[key] : mode), 0);

export const modeToPermissions = (mode: number): PermissionChecks =>
  PERMISSION_KEYS.reduce(
    (checks, key) => ({
      ...checks,
      [key]: (mode & PERMISSION_BITS[key]) !== 0,
    }),
    {} as PermissionChecks,
  );

/** Three-digit octal for the editor; values above 7777 are rejected. */
export const formatOctalMode = (mode: number): string =>
  (mode & 0o7777).toString(8).padStart(3, '0');

/** Parse a numeric octal input, returning null for invalid values. */
export const parseOctalMode = (value: string): number | null => {
  if (!/^[0-7]{1,4}$/.test(value)) return null;
  const mode = parseInt(value, 8);
  return mode <= 0o7777 ? mode : null;
};
