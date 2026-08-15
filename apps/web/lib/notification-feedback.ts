// Haptic + sound feedback for an incoming staff notification (new order,
// order ready, etc. — see notification-bell.tsx). Sibling to
// `celebrate.ts` (guest QR order-confirmation feedback), reusing the same
// feature-detection pattern (best-effort `navigator.vibrate`, `AudioContext`
// with the `webkitAudioContext` fallback), but with its own distinct
// pattern/tone so the two moments don't sound or feel the same — a guest
// placing an order and a waiter/kitchen staffer getting alerted are
// different-enough moments to deserve different feedback. `celebrate.ts`
// itself is untouched; it's still used only for the QR flow.

export function vibrateNotification() {
  if (typeof navigator === "undefined" || !navigator.vibrate) return;
  // Short double-buzz — deliberately curter and sharper than the guest
  // success pattern ([15, 40, 15]), so it reads as "heads up" rather than
  // "celebration" on a phone/tablet in a pocket or apron.
  navigator.vibrate([25, 60, 25, 60, 25]);
}

// Synthesized double-beep (two identical short blips, not the guest chime's
// rising two-note "ta-da") — an alert tone, not a reward tone. Runs in
// response to a `notification.created` socket event, which is not itself a
// user gesture, so on browsers with strict autoplay policies this can
// silently no-op the first time in a tab; best-effort only, same as
// celebrate.ts.
export function playNotificationBeep() {
  if (typeof window === "undefined") return;
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctx) return;

  try {
    const ctx = new Ctx();
    const beeps: [start: number, duration: number][] = [
      [0, 0.09],
      [0.14, 0.09],
    ];

    beeps.forEach(([start, duration]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 1046.5; // C6 — brighter/more alert than the chime's A5/E6 notes
      osc.connect(gain);
      gain.connect(ctx.destination);

      const t0 = ctx.currentTime + start;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.15, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);

      osc.start(t0);
      osc.stop(t0 + duration + 0.02);
    });

    setTimeout(() => ctx.close(), 500);
  } catch {
    // Autoplay/permissions edge cases — the visual bell badge still stands.
  }
}

// Convenience combined call for the common case (bell component calls this
// directly unless the user has muted this device).
export function playNotificationFeedback() {
  vibrateNotification();
  playNotificationBeep();
}
