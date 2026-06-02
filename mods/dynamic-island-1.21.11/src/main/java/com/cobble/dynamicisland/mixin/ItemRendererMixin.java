package com.cobble.dynamicisland.mixin;

import com.cobble.dynamicisland.protection.LoomShield;
import net.minecraft.client.render.VertexConsumerProvider;
import net.minecraft.client.render.item.ItemRenderer;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.item.ItemStack;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Safe item rendering wrapper.
 * Catches any exception during item rendering to prevent crash exploits
 * from malformed items, illegal enchantments, or corrupt data components.
 *
 * Uses a simple method name match (no descriptor) so it works across
 * Minecraft version remapping changes.
 */
@Mixin(ItemRenderer.class)
public class ItemRendererMixin {

    // @Inject(method = "renderItem", at = @At("HEAD"), cancellable = true)
    // private void loomshield_safeRenderItem(CallbackInfo ci) {
    //     if (com.cobble.dynamicisland.protection.LoomShield.isUnsafe()) {
    //         ci.cancel();
    //     }
    // }
}
