package com.loom.lazyinit;

/**
 * Simple config holder. Reads from system properties so users can toggle
 * individual deferrals via JVM args without needing a config file parser.
 *
 * <p>Example: {@code -Dloom.lazyinit.recipes=false} disables recipe deferral.
 *
 * <p>All deferrals are enabled by default.
 */
public final class LazyInitConfig {

    public static final boolean DEFER_RECIPES = bool("loom.lazyinit.recipes", true);
    public static final boolean DEFER_ADVANCEMENTS = bool("loom.lazyinit.advancements", true);
    public static final boolean DEFER_ENTITY_MODELS = bool("loom.lazyinit.entitymodels", true);
    public static final boolean DEFER_SOUNDS = bool("loom.lazyinit.sounds", true);

    private LazyInitConfig() {}

    private static boolean bool(String key, boolean def) {
        String v = System.getProperty(key);
        if (v == null) return def;
        return Boolean.parseBoolean(v);
    }
}
