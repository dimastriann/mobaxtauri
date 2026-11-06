import { type Session, sessionConfigId } from '../store/useSessionStore';

/**
 * Human-readable tab titles. The first instance of a profile keeps its
 * name; additional instances get `(2)`, `(3)`, ...
 */
export const buildTabDisplayNames = (
  openSessions: Session[],
  configs: Session[],
): Map<string, string> => {
  const displayNames = new Map<string, string>();
  const instanceCounts = new Map<string, number>();
  for (const session of openSessions) {
    const configId = sessionConfigId(session);
    const config = configs.find((entry) => entry.id === configId && !entry.ephemeral);
    const baseName = config?.name ?? session.name;
    const nextCount = (instanceCounts.get(configId) ?? 0) + 1;
    instanceCounts.set(configId, nextCount);
    displayNames.set(session.id, nextCount === 1 ? baseName : `${baseName} (${nextCount})`);
  }
  return displayNames;
};
