import { useCallback } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api } from './api';

export type SocialProfile = { first_name: string; bio: string; area: string; share_walks: boolean };
export const emptySocialProfile: SocialProfile = { first_name: '', bio: '', area: '', share_walks: false };
export type Member = { id: string; name: string; bio: string };
export type Friend = Member & {
  status: 'incoming' | 'outgoing' | 'friend';
  walk?: { id: string; title: string; variant: string };
};

export function useWalkPresence(walkId: string, variant: string, active: boolean) {
  useFocusEffect(useCallback(() => {
    if (!active) return;
    let stopped = false;
    let enabled = false;
    let pulsing = false;
    let session: string | undefined;
    let queue = Promise.resolve();

    const end = () => {
      if (!session) return;
      const previousSession = session;
      session = undefined;
      queue = queue.then(async () => {
        await api(`/me/walk-presence/${previousSession}`, { method: 'DELETE' }).catch(() => {});
      });
    };
    const pulse = () => {
      if (!enabled || stopped || pulsing || (AppState.currentState && AppState.currentState !== 'active')) return;
      session ??= `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      const current = session;
      pulsing = true;
      queue = queue.then(async () => {
        if (!stopped && session === current) await api('/me/walk-presence', {
          method: 'PUT', body: JSON.stringify({ walk_id: walkId, variant, session: current }),
        }).catch(() => {});
      }).finally(() => { pulsing = false; });
    };
    void api('/me/social').then((profile: SocialProfile) => {
      enabled = profile.share_walks;
      pulse();
    }).catch(() => {});
    const timer = setInterval(pulse, 20000);
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') pulse(); else end();
    });
    return () => {
      stopped = true;
      clearInterval(timer);
      appState.remove();
      end();
    };
  }, [walkId, variant, active]));
}
