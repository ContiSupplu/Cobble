package com.loom.optimizer;

import net.fabricmc.api.ClientModInitializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Loom Optimizer — Launch-time performance optimizations for Loom Launcher.
 *
 * Three systems:
 * 1. Asset Pre-loading (page cache warming) — background thread reads all assets on first launch
 * 2. Resource Reload Optimization — skip redundant resource reloads via hash tracking
 * 3. Deferred Init Manager — queue non-critical init to run after the title screen renders
 */
public class LoomOptimizerMod implements ClientModInitializer {

    public static final String MOD_ID = "loom-optimizer";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    @Override
    public void onInitializeClient() {
        long startTime = System.nanoTime();
        LOGGER.info("[LoomOptimizer] Initializing...");

        // 1. Start asset pre-loading (page cache warming) on a background daemon thread.
        //    This reads all files under .minecraft/assets/ so the OS page cache has them in RAM
        //    before Minecraft actually needs them.
        AssetPreloader.start();

        // 2. Resource reload optimization is handled by SimpleResourceReloadMixin — no init needed here.
        //    The mixin intercepts SimpleResourceReload.start() and skips reloads when the
        //    resource pack list hash hasn't changed.

        // 3. Deferred init is ready — other mods can call DeferredInitManager.defer(Runnable)
        //    during their ClientModInitializer. The queued tasks run on a background thread
        //    after the title screen first renders (detected via MinecraftClientTickMixin).
        LOGGER.info("[LoomOptimizer] DeferredInitManager ready — {} task(s) already queued",
                DeferredInitManager.getPendingCount());

        double elapsed = (System.nanoTime() - startTime) / 1_000_000.0;
        LOGGER.info("[LoomOptimizer] Initialization complete in {:.1f}ms", elapsed);
    }
}
