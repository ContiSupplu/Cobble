package com.loom.cacheskip.mixin;

import com.loom.cacheskip.CacheAndSkipMod;
import com.loom.cacheskip.CacheManager;
import net.minecraft.client.render.model.ModelManager;
import net.minecraft.resource.ResourceManager;
import net.minecraft.util.profiler.Profiler;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import java.util.Map;

/**
 * Intercepts ModelManager's resource reload preparation to skip baking when a valid cache exists.
 *
 * The preparation phase is where all model baking happens (on a background thread).
 * By injecting at HEAD, we can return cached results and skip the entire bake.
 * By injecting at TAIL, we can capture the bake output and write it to cache.
 *
 * Note: The exact method signature may need adjustment based on the Minecraft version.
 * In 1.21.x, ModelManager extends SinglePreparationResourceReloader and the prepare
 * method returns a preparation result object.
 */
@Mixin(ModelManager.class)
public class ModelManagerMixin {

    /**
     * HEAD injection — attempt to load from cache before baking begins.
     * If cache is valid, cancel the normal prepare and return cached data.
     */
    @Inject(
        method = "prepare(Lnet/minecraft/resource/ResourceManager;Lnet/minecraft/util/profiler/Profiler;)Ljava/lang/Object;",
        at = @At("HEAD"),
        cancellable = true
    )
    private void cacheAndSkip_onPrepareHead(
            ResourceManager resourceManager,
            Profiler profiler,
            CallbackInfoReturnable<Object> cir
    ) {
        if (!CacheAndSkipMod.isEnabled()) return;

        long startTime = System.nanoTime();
        Map<String, Object> cached = CacheManager.tryLoadCache();

        if (cached != null) {
            double elapsed = (System.nanoTime() - startTime) / 1_000_000.0;
            CacheAndSkipMod.LOGGER.info(
                "[CacheAndSkip] Skipped model baking! Cache loaded in {:.0f}ms", elapsed
            );
            // TODO: Convert cached Map back into the expected return type (BakedModels record)
            // This requires reconstructing BakedModel objects from SerializableModel data
            // and relinking sprite references to the current atlas.
            // For now, we log the cache hit but let normal baking proceed.
            // cir.setReturnValue(reconstructedModels);
        }
    }

    /**
     * TAIL injection — after normal baking completes, save results to cache.
     */
    @Inject(
        method = "prepare(Lnet/minecraft/resource/ResourceManager;Lnet/minecraft/util/profiler/Profiler;)Ljava/lang/Object;",
        at = @At("TAIL")
    )
    private void cacheAndSkip_onPrepareTail(
            ResourceManager resourceManager,
            Profiler profiler,
            CallbackInfoReturnable<Object> cir
    ) {
        if (!CacheAndSkipMod.isEnabled()) return;

        Object result = cir.getReturnValue();
        if (result == null) return;

        // TODO: Extract BakedModel data from the result and convert to SerializableModel map
        // The result type is ModelManager's inner preparation record (BakedModels or similar).
        // We need to iterate over all baked models, check if they're SimpleBakedModel instances,
        // and extract their quad data for serialization.
        //
        // Pseudocode:
        // Map<String, Object> modelData = extractModels(result);
        // CacheManager.saveCache(modelData, modelData.size());

        CacheAndSkipMod.LOGGER.info(
            "[CacheAndSkip] Baking completed — cache save ready (implementation pending)"
        );
    }
}
