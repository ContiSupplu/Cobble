package com.loom.lazyinit.mixin;

import com.google.gson.JsonElement;
import com.loom.lazyinit.DeferredRecipeManager;
import net.minecraft.recipe.RecipeManager;
import net.minecraft.resource.ResourceManager;
import net.minecraft.util.Identifier;
import net.minecraft.util.profiler.Profiler;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import java.util.Map;

/**
 * Mixin into {@link RecipeManager} to defer recipe parsing during the
 * initial resource reload. Recipes are only needed when the player opens
 * a crafting interface in-world, so parsing them during startup is wasted work.
 *
 * <p>The first call to {@code apply()} stashes the raw JSON data and returns
 * immediately. On world join, the stashed data is parsed on a background thread.
 * Subsequent reloads (F3+T) proceed normally.
 */
@Mixin(RecipeManager.class)
public abstract class RecipeManagerMixin {

    /**
     * Intercept the apply() method from JsonDataLoader / SimpleJsonResourceReloadListener.
     * On the first invocation, stash data and skip parsing.
     */
    @Inject(
            method = "apply(Ljava/util/Map;Lnet/minecraft/resource/ResourceManager;Lnet/minecraft/util/profiler/Profiler;)V",
            at = @At("HEAD"),
            cancellable = true
    )
    private void loomLazyInit$deferRecipeParsing(
            Map<Identifier, JsonElement> map,
            ResourceManager resourceManager,
            Profiler profiler,
            CallbackInfo ci
    ) {
        if (!DeferredRecipeManager.shouldDefer()) {
            return; // not deferring — let vanilla proceed
        }

        try {
            // Stash the data for later parsing
            DeferredRecipeManager.stash(map, resourceManager, profiler);

            // Capture a reference to 'this' (the RecipeManager) so the callback
            // can invoke the real apply() later
            RecipeManager self = (RecipeManager) (Object) this;
            DeferredRecipeManager.setParseCallback(() -> {
                Map<Identifier, JsonElement> data = DeferredRecipeManager.getStashedData();
                ResourceManager mgr = DeferredRecipeManager.getStashedResourceManager();
                Profiler prof = DeferredRecipeManager.getStashedProfiler();
                if (data != null && mgr != null && prof != null) {
                    // Call the real apply — by this point shouldDefer() returns false,
                    // so we won't re-enter this injection
                    ((RecipeManagerAccessor) self).loomLazyInit$callApply(data, mgr, prof);
                }
            });

            ci.cancel(); // skip the original apply()
        } catch (Exception e) {
            // Fault tolerance: if anything goes wrong, let vanilla handle it
            DeferredRecipeManager.triggerDeferredParse(); // mark as no longer deferred
            // don't cancel — let the original apply() proceed
        }
    }

    /**
     * Accessor interface to call the real apply() from the deferred callback.
     * This is implemented as an inner interface so we can invokeinterface on it.
     */
    public interface RecipeManagerAccessor {
        void loomLazyInit$callApply(Map<Identifier, JsonElement> map, ResourceManager mgr, Profiler profiler);
    }
}
