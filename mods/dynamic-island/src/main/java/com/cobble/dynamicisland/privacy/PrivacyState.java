package com.cobble.dynamicisland.privacy;

/**
 * Shared state for Privacy Mode features.
 * Used by mixins that cannot have public static methods.
 */
public class PrivacyState {
    /** Cached alias for tab list name hiding */
    public static volatile String cachedAlias = null;

    /** Cached skin identifier for skin randomizer */
    public static volatile Object cachedSkin = null;
    public static volatile Object cachedModel = null;

    /** Reset alias (call when toggling privacy mode on) */
    public static void resetAlias() {
        cachedAlias = null;
    }

    /** Reset skin (call when toggling privacy mode on) */
    public static void resetSkin() {
        cachedSkin = null;
        cachedModel = null;
    }
}
