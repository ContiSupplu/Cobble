package com.loom.cacheskip;

import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.loader.api.ModContainer;
import org.slf4j.Logger;

import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Computes a fingerprint of the current mod + resource pack configuration.
 * The fingerprint changes whenever any mod is added, removed, or updated,
 * or when the resource pack list changes — invalidating the cache.
 */
public final class CacheFingerprint {

    private static final Logger LOGGER = CacheAndSkipMod.LOGGER;
    private static String cachedFingerprint = null;

    private CacheFingerprint() {}

    /**
     * Compute the fingerprint for the current launch configuration.
     * Result is cached for the duration of the session.
     */
    public static String compute() {
        if (cachedFingerprint != null) return cachedFingerprint;

        long start = System.nanoTime();
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");

            // 1. Minecraft version
            String mcVersion = "mc:" + getMinecraftVersion();
            md.update(mcVersion.getBytes());

            // 2. Fabric loader version
            String loaderVersion = "loader:" + FabricLoader.getInstance().getModContainer("fabricloader")
                    .map(m -> m.getMetadata().getVersion().getFriendlyString())
                    .orElse("unknown");
            md.update(loaderVersion.getBytes());

            // 3. All mod JARs — sorted by mod ID for determinism
            List<String> modEntries = new ArrayList<>();
            for (ModContainer mod : FabricLoader.getInstance().getAllMods()) {
                String modId = mod.getMetadata().getId();
                String modVersion = mod.getMetadata().getVersion().getFriendlyString();
                // Get the mod's root path for size info
                Path rootPath = mod.getRootPaths().isEmpty() ? null : mod.getRootPaths().get(0);
                long size = 0;
                if (rootPath != null) {
                    try {
                        // For JAR mods, get the file size
                        Path jarPath = mod.getOrigin().getPaths().isEmpty() ? null : mod.getOrigin().getPaths().get(0);
                        if (jarPath != null && Files.exists(jarPath)) {
                            size = Files.size(jarPath);
                        }
                    } catch (Exception e) {
                        // Built-in mods may not have a JAR
                    }
                }
                modEntries.add(modId + ":" + modVersion + ":" + size);
            }
            Collections.sort(modEntries);
            for (String entry : modEntries) {
                md.update(entry.getBytes());
            }

            // 4. Resource packs — check the options.txt for active pack list
            Path optionsFile = FabricLoader.getInstance().getGameDir().resolve("options.txt");
            if (Files.exists(optionsFile)) {
                try {
                    List<String> lines = Files.readAllLines(optionsFile);
                    for (String line : lines) {
                        if (line.startsWith("resourcePacks:")) {
                            md.update(line.getBytes());
                            break;
                        }
                    }
                } catch (IOException e) {
                    md.update("packs:unknown".getBytes());
                }
            }

            // 5. Compute final hash
            byte[] digest = md.digest();
            StringBuilder sb = new StringBuilder();
            for (byte b : digest) {
                sb.append(String.format("%02x", b & 0xff));
            }

            cachedFingerprint = sb.toString();
            double elapsed = (System.nanoTime() - start) / 1_000_000.0;
            LOGGER.info("[CacheAndSkip] Fingerprint computed in {:.1f}ms: {}",
                    elapsed, cachedFingerprint.substring(0, 16) + "...");

            return cachedFingerprint;

        } catch (NoSuchAlgorithmException e) {
            LOGGER.error("[CacheAndSkip] SHA-256 not available", e);
            return "unavailable-" + System.currentTimeMillis();
        }
    }

    /**
     * Reset the cached fingerprint (for testing or forced invalidation).
     */
    public static void reset() {
        cachedFingerprint = null;
    }

    private static String getMinecraftVersion() {
        return FabricLoader.getInstance().getModContainer("minecraft")
                .map(m -> m.getMetadata().getVersion().getFriendlyString())
                .orElse("unknown");
    }
}
