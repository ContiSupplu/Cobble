package com.cobble.dynamicisland.mixin;

import com.cobble.dynamicisland.LoomLoadingScreen;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.SplashOverlay;
import net.minecraft.resource.ResourceReload;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Replaces Minecraft's default Mojang splash screen with the
 * Loom-branded loading screen.
 *
 * Hooks the render() method at HEAD, reads the ResourceReload
 * progress, delegates all drawing to {@link LoomLoadingScreen},
 * and cancels the vanilla rendering.
 *
 * When loading completes, the custom screen fades out and then
 * allows vanilla cleanup to proceed by not cancelling the final
 * render call (which triggers overlay removal).
 */
@Mixin(SplashOverlay.class)
public class SplashOverlayMixin {

    @Shadow @Final
    private ResourceReload reload;

    @Shadow
    private float progress;

    @Shadow
    private long reloadCompleteTime;

    @Unique
    private boolean loom_hasReset = false;

    @Inject(method = "render", at = @At("HEAD"), cancellable = true)
    private void loom_renderCustomSplash(DrawContext context, int mouseX, int mouseY, float delta, CallbackInfo ci) {
        // Reset loading screen state on first render of a new splash
        if (!loom_hasReset) {
            LoomLoadingScreen.reset();
            loom_hasReset = true;
        }

        // Read actual reload progress (0.0 - 1.0)
        float reloadProgress = this.reload.getProgress();

        // Determine if reload is complete
        boolean reloadDone = this.reload.isComplete();

        // Render our custom loading screen
        boolean fullyFadedOut = LoomLoadingScreen.render(context, reloadProgress, reloadDone);

        if (fullyFadedOut) {
            // Let the vanilla render method run its final frame so it
            // can do cleanup (remove the overlay, call exceptionHandler, etc.)
            loom_hasReset = false;
            return;
        }

        // Cancel vanilla rendering — we've drawn our own screen
        ci.cancel();
    }
}
