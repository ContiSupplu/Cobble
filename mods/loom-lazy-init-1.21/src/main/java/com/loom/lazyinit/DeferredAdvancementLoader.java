package com.loom.lazyinit;

import com.google.gson.JsonElement;
import net.minecraft.resource.ResourceManager;
import net.minecraft.util.Identifier;
import net.minecraft.util.profiler.Profiler;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Holds deferred advancement data and provides the mechanism to load it
 * on a background thread when the player first joins a world.
 */
public final class DeferredAdvancementLoader {

    private static final Logger LOGGER = LoggerFactory.getLogger("loom-lazy-init/advancements");

    private static final AtomicBoolean deferred = new AtomicBoolean(true);
    private static final AtomicReference<Map<Identifier, JsonElement>> stashedData = new AtomicReference<>();
    private static final AtomicReference<ResourceManager> stashedResourceManager = new AtomicReference<>();
    private static final AtomicReference<Profiler> stashedProfiler = new AtomicReference<>();
    private static volatile Runnable loadCallback;

    private DeferredAdvancementLoader() {}

    public static boolean shouldDefer() {
        return deferred.get() && LazyInitConfig.DEFER_ADVANCEMENTS;
    }

    public static void stash(Map<Identifier, JsonElement> data, ResourceManager manager, Profiler profiler) {
        stashedData.set(data);
        stashedResourceManager.set(manager);
        stashedProfiler.set(profiler);
        LOGGER.info("[loom-lazy-init] Deferred {} advancement entries — will load on world join", data.size());
    }

    public static void setLoadCallback(Runnable callback) {
        loadCallback = callback;
    }

    public static void triggerDeferredLoad() {
        if (!deferred.compareAndSet(true, false)) {
            return;
        }

        Runnable cb = loadCallback;
        if (cb == null) {
            LOGGER.warn("[loom-lazy-init] No advancement load callback registered — advancements may not have been deferred");
            return;
        }

        long start = System.nanoTime();
        CompletableFuture.runAsync(() -> {
            try {
                LOGGER.info("[loom-lazy-init] Loading deferred advancements on background thread...");
                cb.run();
                long elapsed = (System.nanoTime() - start) / 1_000_000;
                LOGGER.info("[loom-lazy-init] Deferred advancement loading completed in {}ms (saved from startup)", elapsed);
            } catch (Exception e) {
                LOGGER.error("[loom-lazy-init] Failed to load deferred advancements — falling back", e);
            } finally {
                stashedData.set(null);
                stashedResourceManager.set(null);
                stashedProfiler.set(null);
                loadCallback = null;
            }
        });
    }

    public static Map<Identifier, JsonElement> getStashedData() {
        return stashedData.get();
    }

    public static ResourceManager getStashedResourceManager() {
        return stashedResourceManager.get();
    }

    public static Profiler getStashedProfiler() {
        return stashedProfiler.get();
    }

    public static boolean isDeferred() {
        return deferred.get();
    }
}
