package com.loom.cacheskip;

import org.slf4j.Logger;

import java.io.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

/**
 * Orchestrates the model/atlas cache lifecycle:
 *  1. On launch: check fingerprint → load cache or let normal bake proceed
 *  2. After bake: serialize results to disk for next launch
 *  3. On config/mod change: invalidate cache
 */
public final class CacheManager {

    private static final Logger LOGGER = CacheAndSkipMod.LOGGER;

    // Magic bytes for cache file identification
    static final byte[] MAGIC = {'C', 'S', 'K', 'P'};
    static final int FORMAT_VERSION = 1;

    // Cache file name
    private static final String CACHE_FILE = "baked-models.bin";
    private static final String FINGERPRINT_FILE = "fingerprint.txt";

    // Track whether cache was used this session
    private static boolean cacheWasLoaded = false;
    private static boolean cacheWasWritten = false;
    private static long savedTimeMs = 0;

    private CacheManager() {}

    /**
     * Attempt to load cached baked models. Returns a Map of model data if the cache
     * is valid, or null if the cache doesn't exist, is invalid, or loading fails.
     *
     * This is called from ModelManagerMixin at HEAD of the prepare() method.
     */
    public static Map<String, Object> tryLoadCache() {
        if (!CacheAndSkipMod.isEnabled()) {
            return null;
        }

        Path cacheDir = CacheAndSkipMod.getCacheDir();
        if (cacheDir == null) return null;

        Path cacheFile = cacheDir.resolve(CACHE_FILE);
        Path fingerprintFile = cacheDir.resolve(FINGERPRINT_FILE);

        // Check if cache exists
        if (!Files.exists(cacheFile) || !Files.exists(fingerprintFile)) {
            LOGGER.info("[CacheAndSkip] No cache found, will bake normally");
            return null;
        }

        // Check fingerprint
        try {
            String storedFingerprint = Files.readString(fingerprintFile).trim();
            String currentFingerprint = CacheFingerprint.compute();

            if (!storedFingerprint.equals(currentFingerprint)) {
                LOGGER.info("[CacheAndSkip] Fingerprint mismatch — cache invalidated");
                LOGGER.info("[CacheAndSkip]   Stored:  {}", storedFingerprint.substring(0, 16) + "...");
                LOGGER.info("[CacheAndSkip]   Current: {}", currentFingerprint.substring(0, 16) + "...");
                invalidateCache();
                return null;
            }
        } catch (IOException e) {
            LOGGER.warn("[CacheAndSkip] Failed to read fingerprint file", e);
            return null;
        }

        // Load cache
        long startTime = System.nanoTime();
        try (DataInputStream dis = new DataInputStream(
                new BufferedInputStream(Files.newInputStream(cacheFile), 1024 * 1024))) {

            // Verify magic bytes
            byte[] magic = new byte[4];
            dis.readFully(magic);
            if (magic[0] != MAGIC[0] || magic[1] != MAGIC[1] ||
                magic[2] != MAGIC[2] || magic[3] != MAGIC[3]) {
                LOGGER.warn("[CacheAndSkip] Invalid cache file (bad magic bytes)");
                invalidateCache();
                return null;
            }

            // Verify format version
            int version = dis.readInt();
            if (version != FORMAT_VERSION) {
                LOGGER.warn("[CacheAndSkip] Cache format version mismatch (got {}, expected {})",
                        version, FORMAT_VERSION);
                invalidateCache();
                return null;
            }

            // Read model count
            int modelCount = dis.readInt();
            LOGGER.info("[CacheAndSkip] Loading {} cached models...", modelCount);

            // Deserialize models
            Map<String, Object> models = ModelCacheSerializer.deserialize(dis, modelCount);

            double elapsed = (System.nanoTime() - startTime) / 1_000_000.0;
            long fileSizeMB = Files.size(cacheFile) / (1024 * 1024);

            cacheWasLoaded = true;
            savedTimeMs = (long) elapsed;

            LOGGER.info("[CacheAndSkip] Cache loaded: {} models from {} MB in {:.0f}ms",
                    modelCount, fileSizeMB, elapsed);

            return models;

        } catch (Exception e) {
            LOGGER.error("[CacheAndSkip] Failed to load cache — falling back to normal bake", e);
            invalidateCache();
            return null;
        }
    }

    /**
     * Save baked models to the cache. Called from ModelManagerMixin at TAIL of prepare().
     *
     * @param modelData The baked model data to serialize
     * @param modelCount Number of models
     */
    public static void saveCache(Map<String, Object> modelData, int modelCount) {
        if (!CacheAndSkipMod.isEnabled() || cacheWasLoaded) {
            return; // Don't re-save if we loaded from cache
        }

        Path cacheDir = CacheAndSkipMod.getCacheDir();
        if (cacheDir == null) return;

        Path cacheFile = cacheDir.resolve(CACHE_FILE);
        Path fingerprintFile = cacheDir.resolve(FINGERPRINT_FILE);

        long startTime = System.nanoTime();
        try {
            Files.createDirectories(cacheDir);

            // Write cache file
            try (DataOutputStream dos = new DataOutputStream(
                    new BufferedOutputStream(Files.newOutputStream(cacheFile), 1024 * 1024))) {

                // Header
                dos.write(MAGIC);
                dos.writeInt(FORMAT_VERSION);
                dos.writeInt(modelCount);

                // Serialize models
                ModelCacheSerializer.serialize(dos, modelData);
            }

            // Write fingerprint
            String fingerprint = CacheFingerprint.compute();
            Files.writeString(fingerprintFile, fingerprint);

            double elapsed = (System.nanoTime() - startTime) / 1_000_000.0;
            long fileSizeMB = Files.size(cacheFile) / (1024 * 1024);

            cacheWasWritten = true;
            LOGGER.info("[CacheAndSkip] Cache written: {} models, {} MB in {:.0f}ms",
                    modelCount, fileSizeMB, elapsed);

        } catch (Exception e) {
            LOGGER.error("[CacheAndSkip] Failed to write cache", e);
            // Clean up partial writes
            try {
                Files.deleteIfExists(cacheFile);
                Files.deleteIfExists(fingerprintFile);
            } catch (IOException ignored) {}
        }
    }

    /**
     * Delete all cache files, forcing a full rebake on next launch.
     */
    public static void invalidateCache() {
        Path cacheDir = CacheAndSkipMod.getCacheDir();
        if (cacheDir == null) return;

        try {
            Path cacheFile = cacheDir.resolve(CACHE_FILE);
            Path fingerprintFile = cacheDir.resolve(FINGERPRINT_FILE);
            boolean deleted = false;
            if (Files.deleteIfExists(cacheFile)) deleted = true;
            if (Files.deleteIfExists(fingerprintFile)) deleted = true;
            if (deleted) {
                LOGGER.info("[CacheAndSkip] Cache invalidated");
            }
        } catch (IOException e) {
            LOGGER.warn("[CacheAndSkip] Failed to delete cache files", e);
        }
    }

    public static boolean wasCacheLoaded() { return cacheWasLoaded; }
    public static boolean wasCacheWritten() { return cacheWasWritten; }
    public static long getSavedTimeMs() { return savedTimeMs; }
}
