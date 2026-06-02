package com.loom.optimizer;

import org.slf4j.Logger;

import java.util.Queue;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Deferred Initialization Manager — allows mods to queue non-critical initialization
 * work that runs AFTER the title screen renders, rather than blocking during
 * ClientModInitializer.
 *
 * Usage from any mod's ClientModInitializer:
 * <pre>
 *   DeferredInitManager.defer(() -> {
 *       // expensive work: network calls, file scanning, config parsing...
 *       loadConfigFromDisk();
 *       fetchRemoteData();
 *   });
 * </pre>
 *
 * The queued tasks run on a single background thread after the title screen is first shown.
 * This is detected by MinecraftClientTickMixin checking if currentScreen is TitleScreen.
 */
public final class DeferredInitManager {

    private static final Logger LOGGER = LoomOptimizerMod.LOGGER;
    private static final Queue<Runnable> pendingTasks = new ConcurrentLinkedQueue<>();
    private static final AtomicBoolean triggered = new AtomicBoolean(false);
    private static final AtomicBoolean running = new AtomicBoolean(false);
    private static final AtomicBoolean completed = new AtomicBoolean(false);
    private static final AtomicInteger totalDeferred = new AtomicInteger(0);

    private DeferredInitManager() {}

    /**
     * Queue a task for deferred execution. Can be called from any thread, at any time
     * before or during ClientModInitializer.
     *
     * If deferred execution has already completed, the task runs immediately on the caller's thread.
     */
    public static void defer(Runnable task) {
        if (task == null) return;

        if (completed.get()) {
            // Already past the deferred window — run immediately
            LOGGER.info("[DeferredInit] Running late-submitted task immediately");
            try {
                task.run();
            } catch (Exception e) {
                LOGGER.error("[DeferredInit] Task failed", e);
            }
            return;
        }

        totalDeferred.incrementAndGet();
        pendingTasks.add(task);
        LOGGER.debug("[DeferredInit] Queued task (total: {})", totalDeferred.get());
    }

    /**
     * Returns the number of tasks currently pending execution.
     */
    public static int getPendingCount() {
        return pendingTasks.size();
    }

    /**
     * Returns true if all deferred tasks have been executed.
     */
    public static boolean isCompleted() {
        return completed.get();
    }

    /**
     * Called by MinecraftClientTickMixin when the title screen is first detected.
     * Starts draining the queue on a background thread.
     */
    public static void onTitleScreenReached() {
        if (!triggered.compareAndSet(false, true)) {
            return; // Already triggered
        }

        int count = pendingTasks.size();
        if (count == 0) {
            LOGGER.info("[DeferredInit] Title screen reached — no deferred tasks queued");
            completed.set(true);
            return;
        }

        LOGGER.info("[DeferredInit] Title screen reached — running {} deferred task(s)", count);

        Thread thread = new Thread(() -> {
            running.set(true);
            long startTime = System.nanoTime();
            int executed = 0;
            int failed = 0;

            Runnable task;
            while ((task = pendingTasks.poll()) != null) {
                try {
                    task.run();
                    executed++;
                } catch (Exception e) {
                    failed++;
                    LOGGER.error("[DeferredInit] Task {} failed", executed + failed, e);
                }
            }

            double elapsed = (System.nanoTime() - startTime) / 1_000_000.0;
            LOGGER.info("[DeferredInit] Completed {} task(s) in {:.1f}ms ({} failed)",
                    executed, elapsed, failed);

            running.set(false);
            completed.set(true);
        }, "LoomOptimizer-DeferredInit");

        thread.setDaemon(true);
        thread.setPriority(Thread.NORM_PRIORITY - 1);
        thread.start();
    }
}
