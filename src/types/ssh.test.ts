import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SSH_CONNECTION_TIMEOUT_SECONDS, getSshConnectionTimeoutSeconds } from './ssh';

describe('getSshConnectionTimeoutSeconds', () => {
  beforeEach(() => localStorage.clear());

  it('returns a valid configured timeout', () => {
    localStorage.setItem('ssh-timeout', '45');

    expect(getSshConnectionTimeoutSeconds()).toBe(45);
  });

  it.each(['', '4', '121', '10.5', 'invalid'])('uses the default for %j', (value) => {
    localStorage.setItem('ssh-timeout', value);

    expect(getSshConnectionTimeoutSeconds()).toBe(DEFAULT_SSH_CONNECTION_TIMEOUT_SECONDS);
  });
});
