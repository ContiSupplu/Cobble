package com.cobble.dynamicisland.mixin;

import com.cobble.dynamicisland.DynamicIslandMod;
import com.cobble.dynamicisland.privacy.PrivacyState;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.AbstractClientPlayerEntity;
import net.minecraft.entity.player.SkinTextures;
import net.minecraft.util.AssetInfo;
import net.minecraft.entity.player.PlayerSkinType;
import net.minecraft.util.Identifier;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import java.util.Random;

/**
 * Privacy Mode — Skin Randomizer
 *
 * When privacy mode is ON, replaces the local player's own skin
 * with one of the built-in default skins (Steve or Alex variants).
 * This is CLIENT-SIDE only — other players still see your real skin.
 */
@Mixin(AbstractClientPlayerEntity.class)
public class SkinRandomizerMixin {

    // ── Default skin textures (built into vanilla) ──
    @Unique
    private static final Identifier[] DEFAULT_SKINS = {
        Identifier.of("minecraft", "textures/entity/player/wide/steve.png"),
        Identifier.of("minecraft", "textures/entity/player/wide/alex.png"),
        Identifier.of("minecraft", "textures/entity/player/wide/ari.png"),
        Identifier.of("minecraft", "textures/entity/player/wide/efe.png"),
        Identifier.of("minecraft", "textures/entity/player/wide/kai.png"),
        Identifier.of("minecraft", "textures/entity/player/wide/makena.png"),
        Identifier.of("minecraft", "textures/entity/player/wide/noor.png"),
        Identifier.of("minecraft", "textures/entity/player/wide/sunny.png"),
        Identifier.of("minecraft", "textures/entity/player/wide/zuri.png"),
        Identifier.of("minecraft", "textures/entity/player/slim/alex.png"),
        Identifier.of("minecraft", "textures/entity/player/slim/ari.png"),
        Identifier.of("minecraft", "textures/entity/player/slim/efe.png"),
        Identifier.of("minecraft", "textures/entity/player/slim/kai.png"),
        Identifier.of("minecraft", "textures/entity/player/slim/makena.png"),
        Identifier.of("minecraft", "textures/entity/player/slim/noor.png"),
        Identifier.of("minecraft", "textures/entity/player/slim/sunny.png"),
        Identifier.of("minecraft", "textures/entity/player/slim/zuri.png"),
    };

    @Inject(method = "getSkin", at = @At("HEAD"), cancellable = true)
    private void dynamicisland_randomizeSkin(CallbackInfoReturnable<SkinTextures> cir) {
        if (!DynamicIslandMod.privacyMode) return;

        MinecraftClient client = MinecraftClient.getInstance();
        if (client.player == null) return;

        // Only replace OUR OWN skin
        AbstractClientPlayerEntity self = (AbstractClientPlayerEntity) (Object) this;
        if (!self.getUuid().equals(client.player.getUuid())) return;

        // Pick a random skin if not cached
        if (PrivacyState.cachedSkin == null) {
            int idx = new Random().nextInt(DEFAULT_SKINS.length);
            PrivacyState.cachedSkin = DEFAULT_SKINS[idx];
            Identifier skin = DEFAULT_SKINS[idx];
            PrivacyState.cachedModel = skin.getPath().contains("slim")
                ? PlayerSkinType.SLIM
                : PlayerSkinType.WIDE;
        }

        // Build a SkinTextures with the randomized default skin
        // 1.21.11: SkinTextures(AssetInfo.TextureAsset body, cape, elytra, PlayerSkinType model, boolean secure)
        Identifier skinId = (Identifier) PrivacyState.cachedSkin;
        AssetInfo.TextureAsset asset = new AssetInfo.TextureAsset() {
            @Override public Identifier id() { return skinId; }
            @Override public Identifier texturePath() { return skinId; }
        };
        cir.setReturnValue(new SkinTextures(
            asset,
            null,
            null,
            (PlayerSkinType) PrivacyState.cachedModel,
            false
        ));
    }
}
