// Haptic + sound feedback for the QR order confirmation moment. Both are
// best-effort: feature-detected and wrapped so a browser without support
// (e.g. iOS Safari has no Vibration API) just silently does nothing.

export function vibrateSuccess() {
  if (typeof navigator === "undefined" || !navigator.vibrate) return;
  navigator.vibrate([15, 40, 15]);
}

// Synthesized rather than an audio file, so there's nothing to bundle or
// host — a short two-note "ta-da" chime via the Web Audio API. Runs as a
// direct result of the guest's own tap on "Place order", which counts as
// the user gesture browsers require before audio can play.
export function playSuccessChime() {
  if (typeof window === "undefined") return;
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;

  try {
    const ctx = new Ctx();
    const notes: [frequency: number, start: number, duration: number][] = [
      [880, 0, 0.14],
      [1318.5, 0.1, 0.22],
    ];

    notes.forEach(([frequency, start, duration]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      osc.connect(gain);
      gain.connect(ctx.destination);

      const t0 = ctx.currentTime + start;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.2, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);

      osc.start(t0);
      osc.stop(t0 + duration + 0.02);
    });

    setTimeout(() => ctx.close(), 500);
  } catch {
    // Autoplay/permissions edge cases — the visual confirmation still stands.
  }
}
