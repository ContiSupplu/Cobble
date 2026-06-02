package com.cobble.dynamicisland;

public class ThemeManager {

    public static class Theme {
        public final String name;
        public final int bgColor;      // RGB (no alpha)
        public final int accentColor;  // ARGB
        public final int textColor;    // ARGB
        public final int borderGlow;   // ARGB, 0 = no glow
        public final boolean useAlbumArt;

        public Theme(String name, int bgColor, int accentColor, int textColor, int borderGlow, boolean useAlbumArt) {
            this.name = name;
            this.bgColor = bgColor;
            this.accentColor = accentColor;
            this.textColor = textColor;
            this.borderGlow = borderGlow;
            this.useAlbumArt = useAlbumArt;
        }
    }

    public static final Theme[] themes = new Theme[] {
        new Theme("Midnight",   0x0A0A0A, 0xFF1DB954, 0xFFDDDDDD, 0,          false),
        new Theme("Neon",       0x080818, 0xFF00FFFF, 0xFFE0E0FF, 0x4000FFFF, false),
        new Theme("Ember",      0x140A04, 0xFFFF6B35, 0xFFFFE0CC, 0x30FF4500, false),
        new Theme("Arctic",     0x0A1520, 0xFF88CCFF, 0xFFD0E8FF, 0x2088CCFF, false),
        new Theme("Album Art",  0x0A0A0A, 0xFF1DB954, 0xFFDDDDDD, 0,          true),
    };

    public static int currentIndex = 0;
    private static Theme currentTheme = themes[0];

    public static void setTheme(int index) {
        if (index < 0 || index >= themes.length) return;
        currentIndex = index;
        currentTheme = themes[index];
    }

    public static void nextTheme() {
        setTheme((currentIndex + 1) % themes.length);
    }

    public static Theme current() {
        return currentTheme;
    }

    public static String getThemeName() {
        return currentTheme.name;
    }

    public static int getThemeCount() {
        return themes.length;
    }

    public static void setThemeByName(String name) {
        if (name == null) return;
        for (int i = 0; i < themes.length; i++) {
            if (themes[i].name.equals(name)) {
                setTheme(i);
                return;
            }
        }
    }
}
