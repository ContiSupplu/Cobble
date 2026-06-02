package com.cobble.dynamicisland;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;
import org.lwjgl.glfw.GLFW;

import java.lang.reflect.Method;
import java.lang.invoke.MethodHandle;
import java.lang.invoke.MethodHandles;

/**
 * In-game browser screen using MCEF (com.cinemamod.mcef).
 * This Screen handles INPUT only — the actual browser texture is rendered
 * by DynamicIslandHud inside the DI panel.
 *
 * Two modes:
 *   1. MEDIA   — Locked to YouTube/Twitch, browser-based playback
 *                 Background playback: browser stays alive when ESC is pressed
 *   2. GENERAL — Full browser with content filtering
 */
public class InGameBrowser extends Screen {

    public enum Mode { MEDIA, GENERAL }

    // ── Static browser state (shared with DynamicIslandHud for rendering) ──
    public static Object activeBrowser;    // MCEFBrowser instance
    public static Object activeRenderer;   // MCEFRenderer instance
    public static boolean isActive = false;
    public static boolean isMcefAvailable = false;
    public static boolean isMcefInitialized = false;
    public static Mode activeMode = Mode.MEDIA;
    public static String activeTab = "youtube"; // "youtube" or "twitch"
    public static String statusMessage = null;
    public static String blockedMessage = null;
    public static long blockedMessageUntil = 0;
    public static boolean backgroundPlayback = false;
    public static String pageTitle = "";

    // Panel position (set by DynamicIslandHud each frame)
    public static int panelX, panelY, panelW, panelH;
    // Browser area inside the panel (with padding for tabs)
    public static int browserX, browserY, browserW, browserH;

    // Desktop URLs for proper zoom level
    private static final String YOUTUBE_URL = "https://www.youtube.com";
    private static final String TWITCH_URL = "https://www.twitch.tv";

    // URL change detection
    private static String lastPolledUrl = "";
    private int pollTicks = 0;
    // Resize tracking
    private static int lastResizeW = 0, lastResizeH = 0;

    // ── Cached MethodHandles (much faster than Method.invoke) ──
    private static MethodHandle hResize, hMousePress, hMouseRelease;
    private static MethodHandle hMouseMove, hMouseWheel;
    private static MethodHandle hKeyPress, hKeyRelease, hKeyTyped;
    private static MethodHandle hLoadURL, hGetURL, hClose, hExecJS;
    private static MethodHandle hGetTextureID;

    // Mouse move throttle (30fps)
    private long lastMouseMoveNanos = 0;
    private static final long MOUSE_MOVE_INTERVAL_NS = 33_333_333L; // ~30fps

    private final Mode mode;

    public InGameBrowser(Mode mode) {
        super(Text.literal(mode == Mode.MEDIA ? "Media Browser" : "Browser"));
        this.mode = mode;
        activeMode = mode;
    }

    @Override
    protected void init() {
        super.init();

        if (isActive && activeBrowser != null) {
            resizeBrowser();
            return;
        }

        activeTab = "youtube";
        lastPolledUrl = "";
        String url = mode == Mode.MEDIA ? YOUTUBE_URL : "https://www.google.com";

        try {
            Class<?> mcefClass = Class.forName("com.cinemamod.mcef.MCEF");
            isMcefAvailable = true;

            Method isInitialized = mcefClass.getMethod("isInitialized");
            isMcefInitialized = (boolean) isInitialized.invoke(null);

            if (!isMcefInitialized) {
                statusMessage = "MCEF is downloading browser libraries...";
                isActive = true;
                return;
            }

            createBrowser(url);
        } catch (ClassNotFoundException e) {
            statusMessage = "MCEF mod is required for the browser";
            isMcefAvailable = false;
            isActive = true;
        } catch (Exception e) {
            statusMessage = "Browser init failed: " + e.getMessage();
            isActive = true;
        }
    }

    /** Convert Method to MethodHandle for near-native call speed */
    private static MethodHandle toHandle(Method m) {
        if (m == null) return null;
        try {
            m.setAccessible(true);
            return MethodHandles.lookup().unreflect(m);
        } catch (Exception e) {
            return null;
        }
    }

    /** Cache all methods as MethodHandles for maximum performance */
    private static void cacheMethods() {
        if (activeBrowser == null) return;
        Class<?> bc = activeBrowser.getClass();
        hResize = toHandle(findMethod(bc, "resize", int.class, int.class));
        hMousePress = toHandle(findMethod(bc, "sendMousePress", int.class, int.class, int.class));
        hMouseRelease = toHandle(findMethod(bc, "sendMouseRelease", int.class, int.class, int.class));
        hMouseMove = toHandle(findMethod(bc, "sendMouseMove", int.class, int.class));
        hMouseWheel = toHandle(findMethod(bc, "sendMouseWheel", int.class, int.class, double.class, int.class));
        hKeyPress = toHandle(findMethod(bc, "sendKeyPress", int.class, long.class, int.class));
        hKeyRelease = toHandle(findMethod(bc, "sendKeyRelease", int.class, long.class, int.class));
        hKeyTyped = toHandle(findMethod(bc, "sendKeyTyped", char.class, int.class));
        hLoadURL = toHandle(findMethod(bc, "loadURL", String.class));
        hGetURL = toHandle(findMethod(bc, "getURL"));
        hClose = toHandle(findMethod(bc, "close"));
        hExecJS = toHandle(findMethod(bc, "executeJavaScript", String.class, String.class, int.class));
        if (activeRenderer != null) {
            hGetTextureID = toHandle(findMethod(activeRenderer.getClass(), "getTextureID"));
        }
        System.out.println("[Browser] MethodHandles cached (high-perf mode)");
    }

    private static Method findMethod(Class<?> cls, String name, Class<?>... params) {
        try { return cls.getMethod(name, params); } catch (Exception e) { return null; }
    }

    private static void clearCachedMethods() {
        hResize = hMousePress = hMouseRelease = hMouseMove = null;
        hMouseWheel = hKeyPress = hKeyRelease = hKeyTyped = null;
        hLoadURL = hGetURL = hClose = hExecJS = hGetTextureID = null;
    }

    private static void createBrowser(String url) {
        try {
            Class<?> mcefClass = Class.forName("com.cinemamod.mcef.MCEF");
            Method createBrowserMethod = mcefClass.getMethod("createBrowser", String.class, boolean.class);
            activeBrowser = createBrowserMethod.invoke(null, url, false);

            Method getRenderer = activeBrowser.getClass().getMethod("getRenderer");
            activeRenderer = getRenderer.invoke(activeBrowser);

            // Cache all methods as MethodHandles
            cacheMethods();

            isActive = true;
            isMcefInitialized = true;
            statusMessage = null;
            lastResizeW = 0;
            lastResizeH = 0;

            // Inject perf CSS
            injectPerfOptimizations();

            // Initial resize
            resizeBrowser();
            System.out.println("[Browser] Created: " + url);
        } catch (Exception e) {
            statusMessage = "Browser creation failed";
            System.out.println("[Browser] createBrowser failed: " + e.getMessage());
        }
    }

    /** Inject CSS that reduces rendering load */
    private static void injectPerfOptimizations() {
        if (hExecJS == null) return;
        try {
            hExecJS.invoke(activeBrowser,
                "(function(){" +
                "var s=document.createElement('style');" +
                "s.id='cobble-perf';" +
                "s.textContent='" +
                "*{scroll-behavior:auto!important}" +
                "';" +
                "if(!document.getElementById('cobble-perf'))document.head.appendChild(s);" +
                "})();",
                "", 0);
        } catch (Throwable ignored) {}
    }

    public static void resizeBrowser() {
        if (activeBrowser == null || hResize == null) return;
        int scaleFactor = (int) MinecraftClient.getInstance().getWindow().getScaleFactor();
        int w = Math.max(browserW * scaleFactor, 200);
        int h = Math.max(browserH * scaleFactor, 200);
        // Cap at 720p to balance quality vs performance
        w = Math.min(w, 1280);
        h = Math.min(h, 720);
        if (w == lastResizeW && h == lastResizeH) return;
        lastResizeW = w;
        lastResizeH = h;
        try { hResize.invoke(activeBrowser, w, h); } catch (Throwable ignored) {}
    }

    /** Pre-warm MCEF on game startup */
    public static void preWarmMcef() {
        new Thread(() -> {
            try {
                Thread.sleep(3000);
                Class<?> mcefClass = Class.forName("com.cinemamod.mcef.MCEF");
                isMcefAvailable = true;
                Method isInit = mcefClass.getMethod("isInitialized");
                isMcefInitialized = (boolean) isInit.invoke(null);
                System.out.println("[Browser] Pre-warm: MCEF available=" + isMcefAvailable + " initialized=" + isMcefInitialized);
            } catch (ClassNotFoundException e) {
                isMcefAvailable = false;
            } catch (Exception e) {
                System.out.println("[Browser] Pre-warm failed: " + e.getMessage());
            }
        }, "MCEF-PreWarm").start();
    }

    // ── Rendering is handled by DynamicIslandHud ──
    @Override
    public void renderBackground(DrawContext ctx, int mouseX, int mouseY, float delta) {}

    @Override
    public void render(DrawContext ctx, int mouseX, int mouseY, float delta) {
        DynamicIslandHud.mouseX = mouseX;
        DynamicIslandHud.mouseY = mouseY;
    }

    // ── Input Forwarding (MethodHandles) ──────────

    @Override
    public boolean mouseClicked(double mouseX, double mouseY, int button) {
        if (activeMode == Mode.MEDIA && mouseY < browserY && mouseY >= panelY) {
            TwitchScreen.clickPending = true;
            TwitchScreen.clickX = (int) mouseX;
            TwitchScreen.clickY = (int) mouseY;
            return true;
        }
        if (activeBrowser != null && hMousePress != null && isInBrowserArea(mouseX, mouseY)) {
            try { hMousePress.invoke(activeBrowser, scaledX(mouseX), scaledY(mouseY), button); } catch (Throwable ignored) {}
            return true;
        }
        return super.mouseClicked(mouseX, mouseY, button);
    }

    @Override
    public boolean mouseReleased(double mouseX, double mouseY, int button) {
        if (activeBrowser != null && hMouseRelease != null) {
            try { hMouseRelease.invoke(activeBrowser, scaledX(mouseX), scaledY(mouseY), button); } catch (Throwable ignored) {}
        }
        return super.mouseReleased(mouseX, mouseY, button);
    }

    @Override
    public void mouseMoved(double mouseX, double mouseY) {
        if (activeBrowser != null && hMouseMove != null) {
            // Throttle mouse moves to ~30fps
            long now = System.nanoTime();
            if (now - lastMouseMoveNanos < MOUSE_MOVE_INTERVAL_NS) return;
            lastMouseMoveNanos = now;
            try { hMouseMove.invoke(activeBrowser, scaledX(mouseX), scaledY(mouseY)); } catch (Throwable ignored) {}
        }
    }

    @Override
    public boolean mouseScrolled(double mouseX, double mouseY, double hAmount, double vAmount) {
        if (activeBrowser != null && hMouseWheel != null && isInBrowserArea(mouseX, mouseY)) {
            try { hMouseWheel.invoke(activeBrowser, scaledX(mouseX), scaledY(mouseY), vAmount, 0); } catch (Throwable ignored) {}
            return true;
        }
        return super.mouseScrolled(mouseX, mouseY, hAmount, vAmount);
    }

    @Override
    public boolean keyPressed(int keyCode, int scanCode, int modifiers) {
        if (keyCode == GLFW.GLFW_KEY_ESCAPE) {
            close();
            return true;
        }
        if (activeBrowser != null && hKeyPress != null) {
            try { hKeyPress.invoke(activeBrowser, keyCode, (long) scanCode, modifiers); } catch (Throwable ignored) {}
            return true;
        }
        return super.keyPressed(keyCode, scanCode, modifiers);
    }

    @Override
    public boolean keyReleased(int keyCode, int scanCode, int modifiers) {
        if (activeBrowser != null && hKeyRelease != null) {
            try { hKeyRelease.invoke(activeBrowser, keyCode, (long) scanCode, modifiers); } catch (Throwable ignored) {}
        }
        return super.keyReleased(keyCode, scanCode, modifiers);
    }

    @Override
    public boolean charTyped(char chr, int modifiers) {
        if (activeBrowser != null && hKeyTyped != null) {
            try { hKeyTyped.invoke(activeBrowser, chr, modifiers); } catch (Throwable ignored) {}
            return true;
        }
        return super.charTyped(chr, modifiers);
    }

    // ── Coordinate Helpers ────────────────────────────

    private int scaledX(double mouseX) {
        // Map GUI mouse position to actual browser resolution
        return (int) ((mouseX - browserX) * lastResizeW / (double) Math.max(browserW, 1));
    }

    private int scaledY(double mouseY) {
        return (int) ((mouseY - browserY) * lastResizeH / (double) Math.max(browserH, 1));
    }

    private boolean isInBrowserArea(double mx, double my) {
        return mx >= browserX && mx < browserX + browserW && my >= browserY && my < browserY + browserH;
    }

    // ── Navigation ────────────────────────────────────

    public static void switchTab(String tab) {
        if (tab.equals(activeTab)) return;
        activeTab = tab;
        loadUrl("youtube".equals(tab) ? YOUTUBE_URL : TWITCH_URL);
    }

    public static void loadUrl(String url) {
        if (activeMode == Mode.GENERAL && ContentFilter.isBlocked(url)) {
            blockedMessage = ContentFilter.getBlockReason(url);
            blockedMessageUntil = System.currentTimeMillis() + 3000;
            return;
        }
        if (activeBrowser != null && hLoadURL != null) {
            try { hLoadURL.invoke(activeBrowser, url); } catch (Throwable ignored) {}
        }
    }

    /** Get browser texture ID */
    public static int getTextureID() {
        if (activeRenderer == null || hGetTextureID == null) return 0;
        try { return (int) hGetTextureID.invoke(activeRenderer); } catch (Throwable e) { return 0; }
    }

    /** Get current browser URL */
    public static String getCurrentUrl() {
        if (activeBrowser == null || hGetURL == null) return "";
        try {
            String url = (String) hGetURL.invoke(activeBrowser);
            return url != null ? url : "";
        } catch (Throwable e) { return ""; }
    }

    @Override
    public void tick() {
        super.tick();

        // If MCEF was downloading, check if ready now
        if (isMcefAvailable && !isMcefInitialized) {
            try {
                Class<?> mcefClass = Class.forName("com.cinemamod.mcef.MCEF");
                Method isInit = mcefClass.getMethod("isInitialized");
                isMcefInitialized = (boolean) isInit.invoke(null);
                if (isMcefInitialized && activeBrowser == null) {
                    String url = activeMode == Mode.MEDIA ? YOUTUBE_URL : "https://www.google.com";
                    createBrowser(url);
                }
            } catch (Exception ignored) {}
        }

        // Poll for URL changes
        pollTicks++;
        if (activeBrowser != null && pollTicks % 20 == 0) {
            String currentUrl = getCurrentUrl();
            if (currentUrl != null && !currentUrl.equals(lastPolledUrl)) {
                lastPolledUrl = currentUrl;
                // Re-inject perf optimizations on every page navigation
                injectPerfOptimizations();

                // General mode: content filter
                if (activeMode == Mode.GENERAL && ContentFilter.isBlocked(currentUrl)) {
                    blockedMessage = ContentFilter.getBlockReason(currentUrl);
                    blockedMessageUntil = System.currentTimeMillis() + 3000;
                    loadUrl("https://www.google.com");
                }
            }
        }
    }

    @Override
    public void close() {
        if (activeMode == Mode.MEDIA && activeBrowser != null) {
            String url = getCurrentUrl();
            boolean isVideoPage = url.contains("youtube.com/watch") || url.contains("youtu.be/")
                || (url.contains("twitch.tv/") && !url.endsWith("twitch.tv/") && !url.contains("/directory"));
            if (isVideoPage) {
                pageTitle = parseTitleFromUrl(url);
                backgroundPlayback = true;
                System.out.println("[Browser] Background playback: " + pageTitle);
            } else {
                destroyBrowser();
            }
        } else {
            destroyBrowser();
        }
        DynamicIslandMod.isMediaOpen = false;
        super.close();
    }

    /** Parse a human-readable title from URL */
    private static String parseTitleFromUrl(String url) {
        try {
            if (url.contains("twitch.tv/")) {
                String path = url.substring(url.indexOf("twitch.tv/") + 10);
                if (path.contains("/")) path = path.substring(0, path.indexOf("/"));
                if (path.contains("?")) path = path.substring(0, path.indexOf("?"));
                if (!path.isEmpty()) {
                    return path.substring(0, 1).toUpperCase() + path.substring(1);
                }
                return "Twitch Stream";
            }
            if (url.contains("youtube.com/watch")) {
                return "Now Playing";
            }
            return "Media";
        } catch (Exception e) {
            return "Media";
        }
    }

    /** Fully destroy the browser instance */
    public static void destroyBrowser() {
        if (activeBrowser != null) {
            if (hClose != null) {
                try { hClose.invoke(activeBrowser); } catch (Throwable ignored) {}
            }
            activeBrowser = null;
            activeRenderer = null;
            clearCachedMethods();
        }
        isActive = false;
        backgroundPlayback = false;
        statusMessage = null;
        pageTitle = "";
    }

    /** Is a browser playing in the background? */
    public static boolean isPlayingInBackground() {
        return backgroundPlayback && activeBrowser != null;
    }

    /** Stop background playback and close browser */
    public static void stopBackground() {
        destroyBrowser();
    }

    @Override
    public boolean shouldPause() { return false; }

    /** Open media browser (or resume if playing in background) */
    public static void openMedia() {
        MinecraftClient.getInstance().execute(() -> {
            if (backgroundPlayback && activeBrowser != null) {
                backgroundPlayback = false;
                DynamicIslandMod.isMediaOpen = true;
                MinecraftClient.getInstance().setScreen(new InGameBrowser(Mode.MEDIA));
            } else {
                MinecraftClient.getInstance().setScreen(new InGameBrowser(Mode.MEDIA));
            }
        });
    }

    /** Open general browser */
    public static void openGeneral() {
        MinecraftClient.getInstance().execute(() ->
            MinecraftClient.getInstance().setScreen(new InGameBrowser(Mode.GENERAL)));
    }
}
