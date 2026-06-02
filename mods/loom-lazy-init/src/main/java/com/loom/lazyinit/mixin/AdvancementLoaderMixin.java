package com.loom.lazyinit.mixin;

import com.google.gson.JsonElement;
import com.loom.lazyinit.DeferredAdvancementLoader;
import net.minecraft.resource.ResourceManager;
import net.minecraft.server.ServerAdvancementLoader;
import net.minecraft.util.Identifier;
import net.minecraft.util.profiler.Profiler;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import java.util.Map;

/**
 * Mixin into {@link ServerAdvancementLoader} to defer advancement loading
 * during the initial resource reload. Advancements are only displayed in-game
 * via the advancement screen, so loading them at startup is unnecessary.
 */
@Mixin(ServerAdvancementLoader.class)
public abstract class AdvancementLoaderMixin {

    @Inject(
            method = "apply(Ljava/util/Map;Lnet/minecraft/resource/ResourceManager;Lnet/minecraft/util/profiler/Profiler;)V",
            at = @At("HEAD"),
            cancellable = true
    )
    private void loomLazyInit$deferAdvancementLoading(
            Map<Identifier, JsonElement> map,
            ResourceManager resourceManager,
            Profiler profiler,
            CallbackInfo ci
    ) {
        if (!DeferredAdvancementLoader.shouldDefer()) {
            return;
        }

        try {
            DeferredAdvancementLoader.stash(map, resourceManager, profiler);

            ServerAdvancementLoader self = (ServerAdvancementLoader) (Object) this;
            DeferredAdvancementLoader.setLoadCallback(() -> {
                Map<Identifier, JsonElement> data = DeferredAdvancementLoader.getStashedData();
                ResourceManager mgr = DeferredAdvancementLoader.getStashedResourceManager();
                Profiler prof = DeferredAdvancementLoader.getStashedProfiler();
                if (data != null && mgr != null && prof != null) {
                    ((AdvancementLoaderAccessor) self).loomLazyInit$callApply(data, mgr, prof);
                }
            });

            ci.cancel();
        } catch (Exception e) {
            DeferredAdvancementLoader.triggerDeferredLoad();
        }
    }

    public interface AdvancementLoaderAccessor {
        void loomLazyInit$callApply(Map<Identifier, JsonElement> map, ResourceManager mgr, Profiler profiler);
    }
}
