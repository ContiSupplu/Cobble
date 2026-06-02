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
 * Holds deferred recipe data and provides the mechanism to parse it
 * on a background thread when the player first joins a world.
 */
public final class DeferredRecipeManager {

    private static final Logger LOGGER = LoggerFactory.getLogger("loom-lazy-init/recipes");

    /** Whether we are currently in deferral mode (first load hasn't been consumed yet). */
    private static final AtomicBoolean deferred = new AtomicBoolean(true);

    /** Stashed raw JSON data from the first resource-reload apply(). */
    private static final AtomicReference<Map<Identifier, JsonElement>> stashedData = new AtomicReference<>();

    /** The ResourceManager captured during the first apply(). */
    private static final AtomicReference<ResourceManager> stashedResourceManager = new AtomicReference<>();

    /** The Profiler captured during the first apply(). */
    private static final AtomicReference<Profiler> stashedProfiler = new AtomicReference<>();

    /** Callback to invoke when we actually want to parse. Set by the mixin. */
    private static volatile Runnable parseCallback;

    private DeferredRecipeManager() {}

    /**
     * Called by the mixin to check whether this apply() should be deferred.
     * Only the very first call is deferred; subsequent reloads (F3+T) apply normally.
     */
    public static boolean shouldDefer() {
        return deferred.get() && LazyInitConfig.DEFER_RECIPES;
    }

    /**
     * Stash the raw JSON data for later parsing.
     */
    public static void stash(Map<Identifier, JsonElement> data, ResourceManager manager, Profiler profiler) {
        stashedData.set(data);
        stashedResourceManager.set(manager);
        stashedProfiler.set(profiler);
        LOGGER.info("[loom-lazy-init] Deferred {} recipe entries — will parse on world join", data.size());
    }

    /**
     * Register the callback that performs the actual parsing (set by the mixin).
     */
    public static void setParseCallback(Runnable callback) {
        parseCallback = callback;
    }

    /**
     * Called on first world join to trigger actual recipe parsing in a background thread.
     */
    public static void triggerDeferredParse() {
        if (!deferred.compareAndSet(true, false)) {
            return; // already triggered
        }

        Runnable cb = parseCallback;
        if (cb == null) {
            LOGGER.warn("[loom-lazy-init] No recipe parse callback registered — recipes may not have been deferred");
            return;
        }

        long start = System.nanoTime();
        CompletableFuture.runAsync(() -> {
            try {
                LOGGER.info("[loom-lazy-init] Parsing deferred recipes on background thread...");
                cb.run();
                long elapsed = (System.nanoTime() - start) / 1_000_000;
                LOGGER.info("[loom-lazy-init] Deferred recipe parsing completed in {}ms (saved from startup)", elapsed);
            } catch (Exception e) {
                LOGGER.error("[loom-lazy-init] Failed to parse deferred recipes — falling back", e);
            } finally {
                // Release references to allow GC
                stashedData.set(null);
                stashedResourceManager.set(null);
                stashedProfiler.set(null);
                parseCallback = null;
            }
        });
    }

    /** @return the stashed recipe data, or null if not stashed / already consumed */
    public static Map<Identifier, JsonElement> getStashedData() {
        return stashedData.get();
    }

    /** @return the stashed resource manager */
    public static ResourceManager getStashedResourceManager() {
        return stashedResourceManager.get();
    }

    /** @return the stashed profiler */
    public static Profiler getStashedProfiler() {
        return stashedProfiler.get();
    }

    /** @return true if recipes are still in deferred state */
    public static boolean isDeferred() {
        return deferred.get();
    }
}
