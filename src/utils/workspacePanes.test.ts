import { describe, expect, it } from 'vitest';
import {
  MAX_WORKSPACE_PANES,
  normalizeActivePaneIndex,
  normalizePaneIndices,
  removeConfigFromPaneLayout,
} from './workspacePanes';

describe('workspacePanes', () => {
  it('defaults to the active tab when no panes are saved', () => {
    expect(normalizePaneIndices(undefined, 3, 2)).toEqual([2]);
    expect(normalizePaneIndices([], 3, 0)).toEqual([0]);
    expect(normalizePaneIndices([1], 0, 0)).toEqual([]);
  });

  it('drops invalid and duplicate indices and always keeps the active tab', () => {
    expect(normalizePaneIndices([0, 0, 3, -1, 1], 4, 2)).toEqual([0, 3, 1, 2]);
    expect(normalizePaneIndices([0, 1, 2, 3, 1], 4, 3)).toEqual([0, 1, 2, 3]);
    expect(normalizePaneIndices([0, 1, 2, 3], 4, 0)).toEqual([0, 1, 2, 3]);
    expect(normalizePaneIndices([0, 1, 2, 3], 4, 3)).toEqual([0, 1, 2, 3]);
  });

  it('caps the pane count and replaces the last pane when the active tab is missing', () => {
    expect(normalizePaneIndices([0, 1, 2, 3], 5, 4)).toEqual([0, 1, 2, 4]);
    expect(normalizePaneIndices([0, 1, 2, 3], 5, 0)).toHaveLength(MAX_WORKSPACE_PANES);
  });

  it('clamps the active pane index', () => {
    expect(normalizeActivePaneIndex(undefined, 2)).toBe(0);
    expect(normalizeActivePaneIndex(1, 2)).toBe(1);
    expect(normalizeActivePaneIndex(9, 2)).toBe(0);
    expect(normalizeActivePaneIndex(0, 0)).toBe(0);
  });

  it('remaps panes when a config is deleted', () => {
    const workspace = {
      configIds: ['a', 'b', 'c', 'd'],
      activeIndex: 2,
      paneIndices: [0, 1, 2, 3],
      activePaneIndex: 2,
    };
    expect(removeConfigFromPaneLayout(workspace, 'b')).toMatchObject({
      configIds: ['a', 'c', 'd'],
      activeIndex: 1,
      paneIndices: [0, 1, 2],
      activePaneIndex: 2,
    });
  });

  it('falls back to the remaining active tab when its config is deleted', () => {
    const workspace = {
      configIds: ['a', 'b', 'c'],
      activeIndex: 2,
      paneIndices: [1, 2],
      activePaneIndex: 1,
    };
    expect(removeConfigFromPaneLayout(workspace, 'c')).toMatchObject({
      configIds: ['a', 'b'],
      activeIndex: 0,
      paneIndices: [1, 0],
      activePaneIndex: 1,
    });
  });
});
