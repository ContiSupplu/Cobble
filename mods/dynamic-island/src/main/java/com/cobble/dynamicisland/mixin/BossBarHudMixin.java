package com.cobble.dynamicisland.mixin;

import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.hud.BossBarHud;
import net.minecraft.client.gui.hud.ClientBossBar;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import java.util.Map;
import java.util.UUID;

/**
 * Hides the vanilla boss bar HUD. Boss bars are instead rendered
 * inside the Dynamic Island pill by DynamicIslandHud.
 */
@Mixin(BossBarHud.class)
public class BossBarHudMixin {

    @Shadow @Final
    private Map<UUID, ClientBossBar> bossBars;

    @Inject(method = "render", at = @At("HEAD"), cancellable = true)
    private void cancelRender(DrawContext ctx, CallbackInfo ci) {
        // Expose boss bar data for the Dynamic Island, then cancel vanilla rendering
        com.cobble.dynamicisland.BossBarTracker.update(bossBars);
        ci.cancel();
    }
}
