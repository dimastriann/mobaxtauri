interface BroadcastSession {
  id: string;
  type: 'ssh' | 'local';
  status: string;
}

/**
 * Panes that may receive replicated keystrokes. The source pane is excluded,
 * and only visible, connected SSH sessions qualify.
 */
export function connectedBroadcastTargets(
  visibleIds: readonly string[],
  sourceId: string,
  sessions: readonly BroadcastSession[],
): string[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const targets: string[] = [];
  for (const id of visibleIds) {
    if (id === sourceId || targets.includes(id)) continue;
    const session = byId.get(id);
    if (session?.type === 'ssh' && session.status === 'connected') targets.push(id);
  }
  return targets;
}
