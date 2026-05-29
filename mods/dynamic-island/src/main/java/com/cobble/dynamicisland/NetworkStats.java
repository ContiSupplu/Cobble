package com.cobble.dynamicisland;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.PlayerListEntry;

/**
 * Tracks server TPS (estimated from world-age deltas) and exposes
 * the player's current ping via PlayerListEntry.
 *
 * Call {@link #tick()} once per client tick. TPS is smoothed with a
 * rolling average over the last {@value #SAMPLE_COUNT} samples.
 */
public class NetworkStats {

    // ── Rolling-average TPS estimation ─────────────────
    private static final int SAMPLE_COUNT = 5;
    private static final double[] tpsSamples = new double[SAMPLE_COUNT];
    private static int sampleIndex = 0;
    private static boolean samplesReady = false;

    private static long lastWorldAge = -1;
    private static long lastSystemTime = 0;
    private static int tickCounter = 0;

    // ── Public accessors ───────────────────────────────
    private static double estimatedTps = 20.0;

    /** Current smoothed TPS (capped at 20.0). */
    public static double getTps() {
        return estimatedTps;
    }

    /** Current ping in ms, or -1 if unavailable. */
    public static int getPing() {
        MinecraftClient client = MinecraftClient.getInstance();
        if (client.player == null || client.getNetworkHandler() == null) return -1;

        PlayerListEntry entry = client.getNetworkHandler()
                .getPlayerListEntry(client.player.getUuid());
        return entry != null ? entry.getLatency() : -1;
    }

    // ── Tick logic ─────────────────────────────────────

    /** Call once per END_CLIENT_TICK. */
    public static void tick() {
        MinecraftClient client = MinecraftClient.getInstance();
        if (client.world == null) {
            reset();
            return;
        }

        tickCounter++;

        // Sample every 20 client ticks (~1 second)
        if (tickCounter % 20 != 0) return;

        long worldAge = client.world.getTime();
        long now = System.currentTimeMillis();

        if (lastWorldAge < 0) {
            // First sample – just record baseline
            lastWorldAge = worldAge;
            lastSystemTime = now;
            return;
        }

        long ageDelta = worldAge - lastWorldAge;
        long timeDelta = now - lastSystemTime;

        if (timeDelta > 0 && ageDelta > 0) {
            double sample = ageDelta / (timeDelta / 1000.0);
            sample = Math.min(sample, 20.0); // cap at 20

            tpsSamples[sampleIndex] = sample;
            sampleIndex = (sampleIndex + 1) % SAMPLE_COUNT;
            if (sampleIndex == 0) samplesReady = true;

            // Compute rolling average
            int count = samplesReady ? SAMPLE_COUNT : sampleIndex;
            if (count > 0) {
                double sum = 0;
                for (int i = 0; i < count; i++) sum += tpsSamples[i];
                estimatedTps = Math.min(sum / count, 20.0);
            }
        }

        lastWorldAge = worldAge;
        lastSystemTime = now;
    }

    /** Reset tracking state (call on disconnect). */
    public static void reset() {
        lastWorldAge = -1;
        lastSystemTime = 0;
        tickCounter = 0;
        sampleIndex = 0;
        samplesReady = false;
        estimatedTps = 20.0;
        for (int i = 0; i < SAMPLE_COUNT; i++) tpsSamples[i] = 0;
    }

    /**
     * Build and send the network_stats WebSocket message.
     * Also shows an in-game notification.
     */
    public static void sendNetworkStats() {
        int ping = getPing();
        double tps = getTps();

        // Format for display
        String pingStr = ping >= 0 ? ping + " ms" : "N/A";
        String tpsStr = String.format("%.1f", tps);

        // Show in-game notification via Dynamic Island
        DynamicIslandMod.triggerNotification(
            "\uD83C\uDF10 Ping: " + pingStr + "  |  TPS: " + tpsStr, "general"
        );

        // Send to launcher via WebSocket
        if (LauncherWebSocket.getInstance() != null && LauncherWebSocket.getInstance().isOpen()) {
            String json = "{\"type\":\"network_stats\",\"ping\":" + ping
                    + ",\"tps\":" + tpsStr + "}";
            LauncherWebSocket.getInstance().send(json);
        }
    }
}
