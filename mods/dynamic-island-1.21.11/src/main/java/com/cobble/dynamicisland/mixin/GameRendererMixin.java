package com.cobble.dynamicisland.mixin;

import com.cobble.dynamicisland.CaptureManager;
import net.minecraft.client.render.GameRenderer;
import net.minecraft.client.render.RenderTickCounter;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Hooks into the end of each frame render to capture the framebuffer
 * for the recording/replay buffer system.
 */
@Mixin(GameRenderer.class)
public class GameRendererMixin {
    @Inject(method = "render", at = @At("TAIL"))
    private void onFrameEnd(RenderTickCounter tickCounter, boolean tick, CallbackInfo ci) {
        CaptureManager.onFrameEnd();
    }
}
