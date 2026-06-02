package com.cobble.dynamicisland.mixin;

import com.cobble.dynamicisland.DynamicIslandMod;
import com.cobble.dynamicisland.privacy.PrivacyState;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.hud.PlayerListHud;
import net.minecraft.client.network.PlayerListEntry;
import net.minecraft.text.Text;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import java.util.Random;

/**
 * Privacy Mode — Tab List Name Hider
 *
 * When privacy mode is ON, replaces the local player's own name
 * in the Tab player list with a randomized alias.
 * This is CLIENT-SIDE only — other players still see your real name.
 * Useful for streamers who don't want to leak their IGN.
 */
@Mixin(PlayerListHud.class)
public class PlayerHiderMixin {

    // ── Random alias pool ──
    @Unique
    private static final String[] ALIASES = {
        "Steve", "Alex", "Herobrine", "Notch", "Jeb_",
        "Dinnerbone", "Grumm", "MHF_Pig", "MHF_Cow",
        "Player123", "CraftMaster", "BlockBreaker",
        "RedstoneKing", "EnderWalker", "NetherExplorer",
        "SkyBuilder", "DiamondMiner", "CreeperSlayer",
        "IronGolem", "VillagerTrader", "WanderingSteve"
    };

    @Inject(method = "getPlayerName", at = @At("HEAD"), cancellable = true)
    private void dynamicisland_hideOwnName(PlayerListEntry entry, CallbackInfoReturnable<Text> cir) {
        if (!DynamicIslandMod.privacyMode) return;

        MinecraftClient client = MinecraftClient.getInstance();
        if (client.player == null) return;

        // Only replace OUR OWN name — leave other players' names untouched
        if (entry.getProfile().getId().equals(client.player.getUuid())) {
            // Pick a random alias if not cached
            if (PrivacyState.cachedAlias == null) {
                PrivacyState.cachedAlias = ALIASES[new Random().nextInt(ALIASES.length)];
            }
            cir.setReturnValue(Text.literal(PrivacyState.cachedAlias));
        }
    }
}
