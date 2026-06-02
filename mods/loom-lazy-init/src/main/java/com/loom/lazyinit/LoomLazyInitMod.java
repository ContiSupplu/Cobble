package com.loom.lazyinit;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Main client entry-point for loom-lazy-init.
 *
 * <p>Registers a world-join callback that triggers deferred initialization
 * for recipes, advancements, entity models, and sounds.
 */
public class LoomLazyInitMod implements ClientModInitializer {

    public static final String MOD_ID = "loom-lazy-init";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    /** Set to {@code true} once the player has joined a world for the first time. */
    private static volatile boolean worldJoined = false;

    @Override
    public void onInitializeClient() {
        LOGGER.info("[loom-lazy-init] Initialising — deferrals: recipes={}, advancements={}, entityModels={}, sounds={}",
                LazyInitConfig.DEFER_RECIPES,
                LazyInitConfig.DEFER_ADVANCEMENTS,
                LazyInitConfig.DEFER_ENTITY_MODELS,
                LazyInitConfig.DEFER_SOUNDS);

        ClientPlayConnectionEvents.JOIN.register((handler, sender, client) -> {
            if (worldJoined) return;
            worldJoined = true;

            LOGGER.info("[loom-lazy-init] First world join detected — running deferred initialisations");

            // Trigger deferred recipe parsing
            if (LazyInitConfig.DEFER_RECIPES) {
                DeferredRecipeManager.triggerDeferredParse();
            }

            // Trigger deferred advancement loading
            if (LazyInitConfig.DEFER_ADVANCEMENTS) {
                DeferredAdvancementLoader.triggerDeferredLoad();
            }

            // Trigger deferred entity model loading
            if (LazyInitConfig.DEFER_ENTITY_MODELS) {
                DeferredEntityModels.triggerDeferredLoad();
            }
        });
    }

    /** @return true once the first world join has occurred */
    public static boolean hasWorldJoined() {
        return worldJoined;
    }

    /** Reset state — useful for returning to title screen and re-joining */
    public static void resetWorldJoined() {
        worldJoined = false;
    }
}
