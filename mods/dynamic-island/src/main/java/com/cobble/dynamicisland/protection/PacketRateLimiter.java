package com.cobble.dynamicisland.protection;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Per-packet-type rate limiter.
 * Uses generous thresholds that allow all legitimate gameplay but catch
 * malicious floods (automated scripts sending thousands of packets/sec).
 *
 * Thresholds are 2-5x higher than any legitimate gameplay scenario.
 */
public class PacketRateLimiter {

    // Rate limits per packet type (packets per second)
    public static final int PARTICLE_LIMIT = 1000;
    public static final int EXPLOSION_LIMIT = 100;
    public static final int SOUND_LIMIT = 500;
    public static final int ENTITY_SPAWN_LIMIT = 1000;
    public static final int VELOCITY_LIMIT = 500;

    // Counters per packet type
    private static final ConcurrentHashMap<String, AtomicInteger> counters = new ConcurrentHashMap<>();
    private static volatile long lastResetTime = System.currentTimeMillis();

    // Packet type keys
    public static final String PARTICLE = "particle";
    public static final String EXPLOSION = "explosion";
    public static final String SOUND = "sound";
    public static final String ENTITY_SPAWN = "entity_spawn";
    public static final String VELOCITY = "velocity";

    /**
     * Check if a packet should be allowed.
     * Returns true if allowed, false if rate limit exceeded.
     */
    public static boolean allow(String packetType) {
        resetIfNeeded();

        int limit = getLimit(packetType);
        if (limit <= 0) return true; // No limit for this type

        AtomicInteger counter = counters.computeIfAbsent(packetType, k -> new AtomicInteger(0));
        int count = counter.incrementAndGet();

        if (count > limit) {
            // Only log the first time we exceed (not every packet)
            if (count == limit + 1) {
                LoomShield.logBlock("Packet Flood",
                    packetType + " rate exceeded (" + limit + "/sec)");
            }
            return false;
        }
        return true;
    }

    /**
     * Reset all counters every second.
     */
    private static void resetIfNeeded() {
        long now = System.currentTimeMillis();
        if (now - lastResetTime >= 1000) {
            lastResetTime = now;
            counters.clear();
        }
    }

    /**
     * Force reset (called on server join).
     */
    public static void reset() {
        counters.clear();
        lastResetTime = System.currentTimeMillis();
    }

    private static int getLimit(String type) {
        switch (type) {
            case PARTICLE: return PARTICLE_LIMIT;
            case EXPLOSION: return EXPLOSION_LIMIT;
            case SOUND: return SOUND_LIMIT;
            case ENTITY_SPAWN: return ENTITY_SPAWN_LIMIT;
            case VELOCITY: return VELOCITY_LIMIT;
            default: return 0;
        }
    }
}
