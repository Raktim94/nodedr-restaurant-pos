"use client";

import { Volume2, VolumeX, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNotificationMute } from "@/hooks/use-notification-mute";
import { playNotificationFeedback } from "@/lib/notification-feedback";
import { unlockAudio, useAudioUnlocked } from "@/lib/audio-unlock";
import { useRealtimeState } from "@/lib/realtime-status";

// Two things a kitchen screen has to be honest about: whether live updates
// are flowing, and whether it is actually allowed to make noise. A browser
// blocks sound until the page is touched, so an untouched screen says so and
// offers one tap to turn it on instead of silently missing every new ticket.
export function LiveStatus() {
  const state = useRealtimeState();
  const unlocked = useAudioUnlocked();
  const [muted, toggleMute] = useNotificationMute();

  return (
    <div className="flex flex-col gap-2">
      {state === "offline" && (
        <p role="status" className="flex items-center gap-2 rounded-xl bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs sm:text-sm text-amber-700 dark:text-amber-400 font-medium">
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
          Live updates are paused - reconnecting. Tickets still refresh every few seconds; nothing is lost.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!muted && !unlocked && (
          <Button
            type="button"
            className="h-9 sm:h-10 rounded-xl px-3.5 text-xs sm:text-sm font-semibold active:scale-95 transition-transform"
            onClick={() => {
              void unlockAudio().then((ok) => ok && playNotificationFeedback());
            }}
          >
            <Volume2 className="h-4 w-4 mr-1.5" aria-hidden />
            Tap to turn on ticket sound
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          className="h-9 sm:h-10 rounded-xl px-3.5 text-xs sm:text-sm font-medium border-border/70 hover:bg-secondary/70 active:scale-95 transition-transform"
          aria-pressed={muted}
          onClick={toggleMute}
          title="Per-device sound setting"
        >
          {muted ? <VolumeX className="h-4 w-4 mr-1.5 text-muted-foreground" aria-hidden /> : <Volume2 className="h-4 w-4 mr-1.5 text-primary" aria-hidden />}
          {muted ? "Sound muted" : "Sound on"}
        </Button>
      </div>
    </div>
  );
}
