export const AUTO_RECONNECT_KEY = 'ssh-auto-reconnect';
export const AUTO_RECONNECT_MAX_DELAY_KEY = 'ssh-auto-reconnect-max';

export interface ReconnectSettings {
  enabled: boolean;
  maxDelaySecs: number;
}

export const DEFAULT_RECONNECT_SETTINGS: ReconnectSettings = {
  enabled: true,
  maxDelaySecs: 30,
};

export const loadReconnectSettings = (): ReconnectSettings => {
  const enabled = localStorage.getItem(AUTO_RECONNECT_KEY);
  const maxDelay = Number(localStorage.getItem(AUTO_RECONNECT_MAX_DELAY_KEY));
  return {
    enabled: enabled === null ? DEFAULT_RECONNECT_SETTINGS.enabled : enabled === 'true',
    maxDelaySecs:
      Number.isInteger(maxDelay) && maxDelay >= 1 && maxDelay <= 300
        ? maxDelay
        : DEFAULT_RECONNECT_SETTINGS.maxDelaySecs,
  };
};

export const saveReconnectSettings = (settings: ReconnectSettings) => {
  localStorage.setItem(AUTO_RECONNECT_KEY, String(settings.enabled));
  localStorage.setItem(AUTO_RECONNECT_MAX_DELAY_KEY, String(settings.maxDelaySecs));
};

/** 1s, 2s, 4s, ... capped at `maxDelaySecs`. `attempt` starts at 1. */
export const reconnectDelayMs = (attempt: number, maxDelaySecs: number): number => {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const maxDelay = Math.max(1, Math.floor(maxDelaySecs));
  const seconds = Math.min(2 ** (safeAttempt - 1), maxDelay);
  return seconds * 1000;
};
