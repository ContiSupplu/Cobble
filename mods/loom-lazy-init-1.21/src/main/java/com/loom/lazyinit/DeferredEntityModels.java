package com.loom.lazyinit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Manages deferred entity model loading.
 *
 * <p>Entity models are only needed when entities are rendered in-world,
 * so we skip their baking during initial resource reload and trigger it
 * lazily on first world join.
 */
public final class DeferredEntityModels {

    private static final Logger LOGGER = LoggerFactory.getLogger("loom-lazy-init/entitymodels");

    private static final AtomicBoolean deferred = new AtomicBoolean(true);
    private static volatile Runnable loadCallback;

    private DeferredEntityModels() {}

    public static boolean shouldDefer() {
        return deferred.get() && LazyInitConfig.DEFER_ENTITY_MODELS;
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
            LOGGER.warn("[loom-lazy-init] No entity model load callback registered — models may not have been deferred");
            return;
        }

        long start = System.nanoTime();
        try {
            // Entity model loading must happen on the render thread because it
            // uploads GL data. Run synchronously but measure the time that was
            // moved off the startup path.
            LOGGER.info("[loom-lazy-init] Loading deferred entity models...");
            cb.run();
            long elapsed = (System.nanoTime() - start) / 1_000_000;
            LOGGER.info("[loom-lazy-init] Deferred entity model loading completed in {}ms (saved from startup)", elapsed);
        } catch (Exception e) {
            LOGGER.error("[loom-lazy-init] Failed to load deferred entity models — falling back", e);
        } finally {
            loadCallback = null;
        }
    }

    public static boolean isDeferred() {
        return deferred.get();
    }
}
