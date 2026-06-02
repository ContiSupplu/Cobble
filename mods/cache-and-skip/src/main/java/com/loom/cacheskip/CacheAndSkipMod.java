package com.loom.cacheskip;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.loader.api.FabricLoader;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;

/**
 * Cache & Skip — Caches baked models and texture atlases to skip recomputation.
 *
 * On first launch (or when mods/packs change), models bake normally and results
 * are written to a binary cache. On subsequent launches with identical mods/packs,
 * the cache is loaded directly, skipping the entire bake pipeline.
 */
public class CacheAndSkipMod implements ClientModInitializer {

    public static final String MOD_ID = "cache-and-skip";
    public static final Logger LOGGER = LoggerFactory.getLogger("CacheAndSkip");

    private static boolean enabled = true;
    private static Path cacheDir;
    private static Path configFile;

    @Override
    public void onInitializeClient() {
        Path gameDir = FabricLoader.getInstance().getGameDir();
        cacheDir = gameDir.resolve("cache").resolve("cache-and-skip");
        configFile = FabricLoader.getInstance().getConfigDir().resolve("cache-and-skip.properties");

        loadConfig();

        if (enabled) {
            LOGGER.info("[CacheAndSkip] Enabled — cache directory: {}", cacheDir);
            try {
                Files.createDirectories(cacheDir);
            } catch (IOException e) {
                LOGGER.error("[CacheAndSkip] Failed to create cache directory", e);
                enabled = false;
            }
        } else {
            LOGGER.info("[CacheAndSkip] Disabled via config");
        }
    }

    private void loadConfig() {
        Properties props = new Properties();
        if (Files.exists(configFile)) {
            try (InputStream in = Files.newInputStream(configFile)) {
                props.load(in);
                enabled = Boolean.parseBoolean(props.getProperty("enabled", "true"));
            } catch (IOException e) {
                LOGGER.warn("[CacheAndSkip] Failed to read config, using defaults");
            }
        } else {
            // Write default config
            saveConfig();
        }
    }

    private void saveConfig() {
        Properties props = new Properties();
        props.setProperty("enabled", String.valueOf(enabled));
        props.setProperty("# Cache & Skip Configuration", "");
        try {
            Files.createDirectories(configFile.getParent());
            try (OutputStream out = Files.newOutputStream(configFile)) {
                props.store(out, "Cache & Skip Configuration\nSet enabled=false to disable model/atlas caching");
            }
        } catch (IOException e) {
            LOGGER.warn("[CacheAndSkip] Failed to write config file");
        }
    }

    public static boolean isEnabled() {
        return enabled;
    }

    public static void setEnabled(boolean value) {
        enabled = value;
    }

    public static Path getCacheDir() {
        return cacheDir;
    }

    public static Path getConfigFile() {
        return configFile;
    }
}
