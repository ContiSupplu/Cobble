package com.cobble.dynamicisland.protection;

import net.minecraft.client.MinecraftClient;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Loom Shield — Central protection manager.
 * Tracks protection state, logs blocked events, manages safe mode and crash loop detection.
 */
public class LoomShield {
    public static boolean enabled = true;
    public static boolean safeMode = false;
    public static long joinTime = 0;
    public static String currentServerIp = "";

    // Recent blocked events for HUD display (thread-safe)
    public static final CopyOnWriteArrayList<BlockedEvent> recentBlocks = new CopyOnWriteArrayList<>();

    // Crash loop tracking
    private static final Path CRASH_DATA_PATH = getCrashDataPath();
    private static final int CRASH_THRESHOLD = 3;
    private static final long CRASH_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

    public static class BlockedEvent {
        public final String type;
        public final String detail;
        public final long timestamp;

        public BlockedEvent(String type, String detail) {
            this.type = type;
            this.detail = detail;
            this.timestamp = System.currentTimeMillis();
        }

        public boolean isExpired() {
            return System.currentTimeMillis() - timestamp > 4000; // Show for 4 seconds
        }
    }

    public static void init() {
        // Check if launcher set safe mode flag
        String safeModeFlag = System.getProperty("loom.safemode", "false");
        if ("true".equals(safeModeFlag)) {
            safeMode = true;
            System.out.println("[LoomShield] Safe mode ENABLED (crash loop detected by launcher)");
        }
        System.out.println("[LoomShield] Protection system initialized");
    }

    public static void onServerJoin(String ip) {
        currentServerIp = ip;
        joinTime = System.currentTimeMillis();

        // Check crash history for this server
        if (shouldEnterSafeMode(ip)) {
            safeMode = true;
            System.out.println("[LoomShield] Safe mode activated for " + ip + " (repeated crashes)");
            notifyPlayer("§e⚠ Loom Shield: Safe mode active (crash loop detected)");
        }

        // Reset rate limiter counters
        PacketRateLimiter.reset();
    }

    public static void onServerDisconnect() {
        // Successful session — reset crash counter
        if (!currentServerIp.isEmpty() && System.currentTimeMillis() - joinTime > 30_000) {
            // Only reset if we were connected for > 30 seconds (successful session)
            resetCrashCount(currentServerIp);
        }
        currentServerIp = "";
        safeMode = false;
        joinTime = 0;
    }

    public static void logBlock(String type, String detail) {
        System.out.println("[LoomShield] BLOCKED " + type + ": " + detail);
        recentBlocks.add(new BlockedEvent(type, detail));
        // Trim old events
        recentBlocks.removeIf(BlockedEvent::isExpired);
    }

    /** Notify the player with an in-game message */
    public static void notifyPlayer(String message) {
        MinecraftClient client = MinecraftClient.getInstance();
        if (client.player != null) {
            client.player.sendMessage(Text.literal(message), false);
        }
    }

    /** Check if we should enter safe mode for a server IP */
    public static boolean shouldEnterSafeMode(String ip) {
        try {
            Properties props = loadCrashData();
            String countStr = props.getProperty(ip + ".count", "0");
            String lastStr = props.getProperty(ip + ".last", "0");
            int count = Integer.parseInt(countStr);
            long lastCrash = Long.parseLong(lastStr);
            return count >= CRASH_THRESHOLD && (System.currentTimeMillis() - lastCrash) < CRASH_WINDOW_MS;
        } catch (Exception e) {
            return false;
        }
    }

    /** Record a crash for the current server */
    public static void recordCrash(String ip) {
        try {
            Properties props = loadCrashData();
            int count = Integer.parseInt(props.getProperty(ip + ".count", "0"));
            props.setProperty(ip + ".count", String.valueOf(count + 1));
            props.setProperty(ip + ".last", String.valueOf(System.currentTimeMillis()));
            saveCrashData(props);
        } catch (Exception e) {
            System.err.println("[LoomShield] Failed to record crash: " + e.getMessage());
        }
    }

    /** Reset crash counter for a server (successful session) */
    public static void resetCrashCount(String ip) {
        try {
            Properties props = loadCrashData();
            props.setProperty(ip + ".count", "0");
            saveCrashData(props);
        } catch (Exception ignored) {}
    }

    /** Is safe mode active and within the protection window? */
    public static boolean isSafeModeActive() {
        return safeMode && (System.currentTimeMillis() - joinTime) < 10_000; // 10 sec window
    }

    // ── Crash data persistence ──

    private static Path getCrashDataPath() {
        String gameDir = System.getProperty("user.dir", ".");
        return Path.of(gameDir, "loom-shield-crashes.properties");
    }

    private static Properties loadCrashData() {
        Properties props = new Properties();
        if (Files.exists(CRASH_DATA_PATH)) {
            try (InputStream in = Files.newInputStream(CRASH_DATA_PATH)) {
                props.load(in);
            } catch (IOException ignored) {}
        }
        return props;
    }

    private static void saveCrashData(Properties props) {
        try (OutputStream out = Files.newOutputStream(CRASH_DATA_PATH)) {
            props.store(out, "Loom Shield crash tracking");
        } catch (IOException ignored) {}
    }
}
