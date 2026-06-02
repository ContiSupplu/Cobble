package com.loom.optimizer.mixin;

import com.loom.optimizer.DeferredInitManager;
import com.loom.optimizer.LoomOptimizerMod;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.TitleScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Mixin on MinecraftClient.tick() to detect when the title screen is first shown.
 * Once detected, triggers DeferredInitManager to run queued tasks on a background thread.
 */
@Mixin(MinecraftClient.class)
public class MinecraftClientTickMixin {

    @Unique
    private boolean loomOptimizer$titleScreenDetected = false;

    @Inject(method = "tick", at = @At("HEAD"))
    private void onTick(CallbackInfo ci) {
        if (loomOptimizer$titleScreenDetected) return;

        MinecraftClient client = (MinecraftClient) (Object) this;
        if (client.currentScreen instanceof TitleScreen) {
            loomOptimizer$titleScreenDetected = true;
            LoomOptimizerMod.LOGGER.info("[LoomOptimizer] Title screen detected — triggering deferred init");
            DeferredInitManager.onTitleScreenReached();
        }
    }
}
