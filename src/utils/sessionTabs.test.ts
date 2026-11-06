import { describe, expect, it } from 'vitest';
import { buildTabDisplayNames } from './sessionTabs';
import type { Session } from '../store/useSessionStore';

const config: Session = {
  id: 'ssh-prod',
  name: 'Production',
  type: 'ssh',
  status: 'disconnected',
};

const instance = (id: string): Session => ({
  ...config,
  id,
  configId: config.id,
  ephemeral: true,
  status: 'connected',
});

describe('buildTabDisplayNames', () => {
  it('suffixes additional instances of the same profile', () => {
    const first = instance('ssh-prod::1');
    const second = instance('ssh-prod::2');
    const names = buildTabDisplayNames([config, first, second], [config]);

    expect(names.get(config.id)).toBe('Production');
    expect(names.get(first.id)).toBe('Production (2)');
    expect(names.get(second.id)).toBe('Production (3)');
  });

  it('keeps the base name for a lone instance', () => {
    const only = instance('ssh-prod::1');
    const names = buildTabDisplayNames([only], [config]);
    expect(names.get(only.id)).toBe('Production');
  });
});
