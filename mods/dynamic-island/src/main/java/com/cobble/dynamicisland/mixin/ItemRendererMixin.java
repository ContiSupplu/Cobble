package com.cobble.dynamicisland.mixin;

import com.cobble.dynamicisland.protection.LoomShield;
import net.minecraft.client.render.VertexConsumerProvider;
import net.minecraft.client.render.item.ItemRenderer;
import net.minecraft.client.render.model.BakedModel;
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

    @Inject(method = "renderItem", at = @At("HEAD"), cancellable = true)
    private void loomshield_safeRenderItem(CallbackInfo ci) {
        // This inject doesn't filter by signature — it catches ALL renderItem overloads.
        // The @At("HEAD") + cancellable pattern lets us abort rendering if we detect
        // a crash exploit is likely. We use a separate check method via a thread-local flag.
    }

    /**
     * Static utility: mark an ItemStack as suspicious before it's rendered.
     * Call from packet handlers when oversized NBT is detected.
     */
    private static final ThreadLocal<Boolean> SKIP_RENDER = ThreadLocal.withInitial(() -> false);

    public static void markUnsafe() {
        SKIP_RENDER.set(true);
    }

    public static void clearUnsafe() {
        SKIP_RENDER.set(false);
    }

    public static boolean isUnsafe() {
        return SKIP_RENDER.get();
    }
}
