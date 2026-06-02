package com.cobble.dynamicisland;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import net.fabricmc.loader.api.FabricLoader;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

public class DynamicIslandConfig {

    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private static final Path CONFIG_PATH =
            FabricLoader.getInstance().getConfigDir().resolve("dynamic-island-settings.json");

    private static DynamicIslandConfig INSTANCE = new DynamicIslandConfig();

    // ── Persisted settings ──────────────────────
    public boolean toggleLowHealth = true;
    public boolean toggleLowHunger = true;
    public boolean toggleDurability = true;
    public boolean togglePlayerNearby = true;
    public boolean toggleWhisper = true;
    public boolean toggleBiome = true;
    public boolean toggleInventoryFull = true;
    public boolean privacyMode = false;
    public String theme = "Midnight"; // ThemeManager theme name

    // ── Access ───────────────────────────────────

    public static DynamicIslandConfig get() {
        return INSTANCE;
    }

    // ── Load ─────────────────────────────────────

    public static void load() {
        if (Files.exists(CONFIG_PATH)) {
            try {
                String json = Files.readString(CONFIG_PATH);
                DynamicIslandConfig loaded = GSON.fromJson(json, DynamicIslandConfig.class);
                if (loaded != null) {
                    INSTANCE = loaded;
                }
                System.out.println("[DynamicIsland] Config loaded from " + CONFIG_PATH);
            } catch (Exception e) {
                System.err.println("[DynamicIsland] Failed to load config, using defaults: " + e.getMessage());
                INSTANCE = new DynamicIslandConfig();
            }
        } else {
            System.out.println("[DynamicIsland] No config file found, using defaults.");
            INSTANCE = new DynamicIslandConfig();
            save(); // write defaults so the file exists
        }
    }

    // ── Save ─────────────────────────────────────

    public static void save() {
        // Snapshot current in-game state into the instance before writing
        INSTANCE.toggleLowHealth = DynamicIslandMod.toggleLowHealth;
        INSTANCE.toggleLowHunger = DynamicIslandMod.toggleLowHunger;
        INSTANCE.toggleDurability = DynamicIslandMod.toggleDurability;
        INSTANCE.togglePlayerNearby = DynamicIslandMod.togglePlayerNearby;
        INSTANCE.toggleWhisper = DynamicIslandMod.toggleWhisper;
        INSTANCE.toggleBiome = DynamicIslandMod.toggleBiome;
        INSTANCE.toggleInventoryFull = DynamicIslandMod.toggleInventoryFull;
        INSTANCE.privacyMode = DynamicIslandMod.privacyMode;
        INSTANCE.theme = ThemeManager.getThemeName();

        try {
            Files.createDirectories(CONFIG_PATH.getParent());
            Files.writeString(CONFIG_PATH, GSON.toJson(INSTANCE));
        } catch (IOException e) {
            System.err.println("[DynamicIsland] Failed to save config: " + e.getMessage());
        }
    }

    // ── Apply loaded config to runtime state ─────

    public static void apply() {
        DynamicIslandMod.toggleLowHealth = INSTANCE.toggleLowHealth;
        DynamicIslandMod.toggleLowHunger = INSTANCE.toggleLowHunger;
        DynamicIslandMod.toggleDurability = INSTANCE.toggleDurability;
        DynamicIslandMod.togglePlayerNearby = INSTANCE.togglePlayerNearby;
        DynamicIslandMod.toggleWhisper = INSTANCE.toggleWhisper;
        DynamicIslandMod.toggleBiome = INSTANCE.toggleBiome;
        DynamicIslandMod.toggleInventoryFull = INSTANCE.toggleInventoryFull;
        DynamicIslandMod.privacyMode = INSTANCE.privacyMode;
        ThemeManager.setThemeByName(INSTANCE.theme);
    }
}
