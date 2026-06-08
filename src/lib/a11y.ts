import type { KeyboardEvent } from 'react';
/** onKeyDown that fires `handler` on Enter/Space (preventDefault on Space to avoid page scroll). */
export function activateOnKey(handler: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
  };
}
