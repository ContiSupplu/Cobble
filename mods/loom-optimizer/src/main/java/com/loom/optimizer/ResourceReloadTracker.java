package com.loom.optimizer;

import org.slf4j.Logger;

import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Tracks resource pack list hashes to detect redundant resource reloads.
 * Used by SimpleResourceReloadMixin to skip reloads when the resource set hasn't changed.
 */
public final class ResourceReloadTracker {

    private static final Logger LOGGER = LoomOptimizerMod.LOGGER;
    private static final AtomicReference<String> lastReloadHash = new AtomicReference<>(null);
    private static final AtomicInteger skippedCount = new AtomicInteger(0);
    private static final AtomicInteger totalCount = new AtomicInteger(0);

    private ResourceReloadTracker() {}

    /**
     * Checks whether a reload should be skipped because the resource set hasn't changed.
     *
     * @param resourcePackListHash  A hash string representing the current set of resource packs.
     * @return true if the reload should be skipped (hash matches previous reload)
     */
    public static boolean shouldSkipReload(String resourcePackListHash) {
        totalCount.incrementAndGet();
        String previous = lastReloadHash.get();

        if (previous != null && previous.equals(resourcePackListHash)) {
            int skipped = skippedCount.incrementAndGet();
            LOGGER.info("[ResourceReload] Skipping redundant reload #{} (hash unchanged: {})",
                    skipped, resourcePackListHash);
            return true;
        }

        lastReloadHash.set(resourcePackListHash);
        LOGGER.info("[ResourceReload] Proceeding with reload (hash: {} -> {})", previous, resourcePackListHash);
        return false;
    }

    /**
     * Force-invalidates the cache so the next reload always proceeds.
     * Useful when resource packs are explicitly changed by the user.
     */
    public static void invalidate() {
        lastReloadHash.set(null);
        LOGGER.debug("[ResourceReload] Cache invalidated");
    }

    public static int getSkippedCount() {
        return skippedCount.get();
    }

    public static int getTotalCount() {
        return totalCount.get();
    }
}
