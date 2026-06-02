package com.cobble.dynamicisland.mixin;

import com.cobble.dynamicisland.DynamicIslandHud;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.hud.PlayerListHud;
import net.minecraft.scoreboard.Scoreboard;
import net.minecraft.scoreboard.ScoreboardObjective;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Detects when the vanilla PlayerListHud (Tab overlay) is being rendered
 * so the Dynamic Island can minimize out of the way.
 * Does NOT cancel the vanilla render — lets the server's tab list show normally.
 */
@Mixin(PlayerListHud.class)
public class PlayerListHudMixin {

    @Inject(method = "render", at = @At("HEAD"))
    private void dynamicisland_detectTabRender(DrawContext context, int scaledWindowWidth,
                                                Scoreboard scoreboard, ScoreboardObjective objective,
                                                CallbackInfo ci) {
        // Signal DI that tab list is visible — it will minimize
        DynamicIslandHud.tabListVisibleThisFrame = true;
    }
}
