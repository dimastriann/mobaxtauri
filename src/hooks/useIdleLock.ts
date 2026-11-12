import { useEffect, useState } from 'react';
import { useCredentialStore } from '../store/useCredentialStore';
import {
  AUTO_LOCK_CHANGED_EVENT,
  autoLockDelayMs,
  loadAutoLockMinutes,
  shouldLockAfterIdle,
} from '../utils/idleLock';

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'] as const;

/**
 * Locks the credential vault after a period without user activity. The timer
 * checks in coarse intervals instead of rescheduling on every mousemove, and
 * an overdue hidden window locks as soon as it becomes visible again.
 */
export function useIdleLock(): void {
  const [minutes, setMinutes] = useState(loadAutoLockMinutes);

  useEffect(() => {
    const update = () => setMinutes(loadAutoLockMinutes());
    window.addEventListener(AUTO_LOCK_CHANGED_EVENT, update);
    return () => window.removeEventListener(AUTO_LOCK_CHANGED_EVENT, update);
  }, []);

  useEffect(() => {
    const timeoutMs = autoLockDelayMs(minutes);
    if (timeoutMs === null) return;

    let lastActivity = Date.now();
    let hiddenSince: number | null = null;
    const lockIfUnlocked = () => {
      if (!useCredentialStore.getState().isUnlocked) return;
      void useCredentialStore.getState().lock();
      lastActivity = Date.now();
    };
    const check = () => {
      if (
        document.visibilityState === 'visible' &&
        shouldLockAfterIdle(lastActivity, Date.now(), timeoutMs)
      ) {
        lockIfUnlocked();
      }
    };
    const activity = () => {
      lastActivity = Date.now();
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenSince = Date.now();
        return;
      }
      if (hiddenSince !== null && shouldLockAfterIdle(hiddenSince, Date.now(), timeoutMs)) {
        lockIfUnlocked();
      }
      hiddenSince = null;
      lastActivity = Date.now();
    };

    const interval = window.setInterval(check, Math.min(timeoutMs, 30_000));
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, activity, { passive: true }));
    window.addEventListener('focus', activity);
    document.addEventListener('visibilitychange', visibility);
    check();

    return () => {
      window.clearInterval(interval);
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, activity));
      window.removeEventListener('focus', activity);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [minutes]);
}
