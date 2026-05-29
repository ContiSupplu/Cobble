package com.cobble.dynamicisland;

import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

public class TimerManager {

    public static class TimerData {
        public final String name;
        public final long durationMs;
        public final long startTime;
        public boolean notifiedStart;
        public boolean enteredCountdown; // last 10 seconds

        public TimerData(String name, long durationMs) {
            this.name = name;
            this.durationMs = durationMs;
            this.startTime = System.currentTimeMillis();
            this.notifiedStart = false;
            this.enteredCountdown = false;
        }
    }

    private static final int MAX_TIMERS = 2;
    private static final List<TimerData> activeTimers = new ArrayList<>();
    private static int tickCounter = 0;

    // Finished timer state (must be dismissed)
    public static String finishedTimerName = null;
    public static long finishedTimerDuration = 0; // for restart
    public static long finishedTimerEndTime = 0;   // when it finished
    public static boolean musicWasPaused = false;   // did we pause music?
    private static final long AUTO_DISMISS_MS = 10000; // 10 seconds auto dismiss

    // Countdown timer (last 10 seconds — displayed live on pill)
    public static TimerData countdownTimer = null;

    // Custom timer picker state (for notification center UI)
    public static int pickerHours = 0;
    public static int pickerMinutes = 0;
    public static int pickerSeconds = 0;

    public static void register() {
        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            tickCounter++;
            if (tickCounter < 4) return; // check every 4 ticks for smoother countdown
            tickCounter = 0;

            // Auto-dismiss finished timer
            if (finishedTimerName != null) {
                if (System.currentTimeMillis() - finishedTimerEndTime > AUTO_DISMISS_MS) {
                    dismissFinishedTimer();
                }
            }

            countdownTimer = null; // reset, will be set if any timer is in last 10s

            Iterator<TimerData> it = activeTimers.iterator();
            while (it.hasNext()) {
                TimerData timer = it.next();
                long remaining = getRemaining(timer);

                if (!timer.notifiedStart) {
                    timer.notifiedStart = true;
                    DynamicIslandMod.triggerSilentNotification(
                            "\u23F1 " + timer.name + " started (" + formatTime(timer.durationMs) + ")",
                            "timer"
                    );
                }

                // Enter countdown mode for last 10 seconds
                if (remaining <= 10000 && remaining > 0) {
                    timer.enteredCountdown = true;
                    countdownTimer = timer;
                }

                // Timer finished
                if (remaining <= 0) {
                    it.remove();
                    // Set finished state (must be dismissed)
                    finishedTimerName = timer.name;
                    finishedTimerDuration = timer.durationMs;
                    finishedTimerEndTime = System.currentTimeMillis();
                    // Pause music
                    pauseMusic();
                    // Fire notification
                    DynamicIslandMod.triggerNotification(
                            "\u23F1 " + timer.name + " finished!",
                            "timer"
                    );
                }
            }
        });
    }

    public static boolean startTimer(String name, long durationMs) {
        if (activeTimers.size() >= MAX_TIMERS) {
            return false;
        }
        activeTimers.add(new TimerData(name, durationMs));
        return true;
    }

    public static boolean startFromPicker() {
        long totalMs = (pickerHours * 3600L + pickerMinutes * 60L + pickerSeconds) * 1000L;
        if (totalMs <= 0) return false;
        String name = formatTime(totalMs);
        return startTimer(name, totalMs);
    }

    public static boolean cancelTimer(int index) {
        if (index < 0 || index >= activeTimers.size()) {
            return false;
        }
        activeTimers.remove(index);
        return true;
    }

    public static void dismissFinishedTimer() {
        if (finishedTimerName != null) {
            finishedTimerName = null;
            // Resume music if we paused it
            if (musicWasPaused) {
                resumeMusic();
                musicWasPaused = false;
            }
        }
    }

    public static void restartFinishedTimer() {
        if (finishedTimerName != null) {
            long dur = finishedTimerDuration;
            String name = finishedTimerName;
            dismissFinishedTimer();
            startTimer(name, dur);
        }
    }

    public static boolean hasFinishedTimer() {
        return finishedTimerName != null;
    }

    public static boolean isInCountdown() {
        return countdownTimer != null;
    }

    public static List<TimerData> getActiveTimers() {
        return activeTimers;
    }

    public static long getRemaining(TimerData timer) {
        long elapsed = System.currentTimeMillis() - timer.startTime;
        return Math.max(0, timer.durationMs - elapsed);
    }

    public static String formatTime(long ms) {
        long totalSeconds = ms / 1000;
        long hours = totalSeconds / 3600;
        long minutes = (totalSeconds % 3600) / 60;
        long seconds = totalSeconds % 60;
        if (hours > 0) {
            return hours + "h " + minutes + "m " + seconds + "s";
        }
        if (minutes > 0) {
            return minutes + "m " + seconds + "s";
        }
        return seconds + "s";
    }

    public static String formatCountdown(long ms) {
        long totalSeconds = (ms + 999) / 1000; // round up
        return String.valueOf(totalSeconds);
    }

    private static void pauseMusic() {
        // Check if music is currently playing before pausing
        LauncherState state = DynamicIslandMod.currentState;
        if (state != null && state.spotify != null && state.spotify.playing) {
            musicWasPaused = true;
            DynamicIslandMod.sendSpotifyCommand("spotify_toggle");
        }
    }

    private static void resumeMusic() {
        DynamicIslandMod.sendSpotifyCommand("spotify_toggle");
    }
}
