export const MAX_WORKSPACE_PANES = 4;

const clampIndex = (index: number, length: number): number => {
  if (length <= 0) return 0;
  return Math.min(Math.max(index, 0), length - 1);
};

const isIndex = (value: unknown, length: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < length;

/**
 * Normalize saved pane indices against the tabs restored for a workspace.
 * Invalid or duplicate entries are dropped, the active tab is always visible,
 * and the result is capped to the supported pane count.
 */
export function normalizePaneIndices(
  candidates: unknown,
  configCount: number,
  activeIndex: number,
): number[] {
  if (configCount <= 0) return [];
  const active = clampIndex(activeIndex, configCount);
  const panes: number[] = [];
  if (Array.isArray(candidates)) {
    for (const candidate of candidates) {
      if (!isIndex(candidate, configCount) || panes.includes(candidate)) continue;
      panes.push(candidate);
      if (panes.length === MAX_WORKSPACE_PANES) break;
    }
  }
  if (panes.length === 0) return [active];
  if (!panes.includes(active)) {
    if (panes.length < MAX_WORKSPACE_PANES) panes.push(active);
    else panes[panes.length - 1] = active;
  }
  return panes;
}

export function normalizeActivePaneIndex(candidate: unknown, paneCount: number): number {
  if (paneCount <= 0) return 0;
  return isIndex(candidate, paneCount) ? candidate : 0;
}

interface PaneWorkspace {
  configIds: string[];
  activeIndex: number;
  paneIndices: number[];
  activePaneIndex: number;
}

/**
 * Remove one config from a saved workspace and remap every pane index.
 * Pane indices refer to positions in `configIds`, so filtering the ids
 * without remapping would point at the wrong tabs.
 */
export function removeConfigFromPaneLayout<T extends PaneWorkspace>(
  workspace: T,
  configId: string,
): T {
  const kept: { oldIndex: number; id: string }[] = [];
  workspace.configIds.forEach((id, oldIndex) => {
    if (id !== configId) kept.push({ oldIndex, id });
  });
  const configIds = kept.map((entry) => entry.id);
  const remap = new Map(kept.map((entry, newIndex) => [entry.oldIndex, newIndex]));
  const activeIndex = remap.get(workspace.activeIndex) ?? 0;
  const mappedPanes = workspace.paneIndices
    .map((index) => remap.get(index))
    .filter((index): index is number => index !== undefined);
  const paneIndices = normalizePaneIndices(mappedPanes, configIds.length, activeIndex);
  return {
    ...workspace,
    configIds,
    activeIndex,
    paneIndices,
    activePaneIndex: normalizeActivePaneIndex(workspace.activePaneIndex, paneIndices.length),
  };
}
