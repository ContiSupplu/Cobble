package com.loom.lazyinit.mixin;

import com.loom.lazyinit.DeferredEntityModels;
import net.minecraft.client.render.entity.EntityRendererFactory;
import net.minecraft.client.render.entity.model.EntityModelLoader;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Mixin into {@link EntityRendererFactory.Context} or the entity model loading pipeline
 * to defer entity model baking during the initial resource reload.
 *
 * <p>Entity models are NOT needed for the title screen — they're only used when
 * rendering entities in-world.
 *
 * <p>We target {@link EntityModelLoader#reload} to skip model loading on the first
 * resource reload and load them lazily on world join.
 */
@Mixin(EntityModelLoader.class)
public abstract class EntityModelsMixin {

    @Inject(
            method = "reload",
            at = @At("HEAD"),
            cancellable = true
    )
    private void loomLazyInit$deferEntityModelLoading(CallbackInfo ci) {
        if (!DeferredEntityModels.shouldDefer()) {
            return;
        }

        try {
            EntityModelLoader self = (EntityModelLoader) (Object) this;

            DeferredEntityModels.setLoadCallback(() -> {
                // The deferred flag is now false, so this won't re-enter
                self.reload(null); // passing null triggers a no-arg-style reload
            });

            ci.cancel();
        } catch (Exception e) {
            // Fault tolerance: let vanilla proceed
            DeferredEntityModels.triggerDeferredLoad();
        }
    }
}
