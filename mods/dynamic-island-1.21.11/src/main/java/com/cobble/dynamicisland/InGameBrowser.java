package com.cobble.dynamicisland;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.Click;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.input.CharInput;
import net.minecraft.client.input.KeyInput;
import net.minecraft.text.Text;
import org.lwjgl.glfw.GLFW;

import java.lang.reflect.Method;

/**
 * In-game browser screen using MCEF Modern (net.dimaskama.mcef.api).
 * Falls back to original MCEF (com.cinemamod.mcef) if Modern is not found.
 *
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
    public static Object activeBrowser;    // MCEFBrowser or LoomBrowser instance
    public static Object activeRenderer;   // MCEFRenderer instance (Classic only)
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

    // Which browser backend is loaded
    private static boolean isModernApi = false;
    private static boolean isLoomEngine = false;

    // Panel position (set by DynamicIslandHud each frame)
    public static int panelX, panelY, panelW, panelH;
    // Browser area inside the panel (with padding for tabs)
    public static int browserX, browserY, browserW, browserH;

    // Desktop URLs for proper zoom level
    private static final String YOUTUBE_URL = "https://www.youtube.com";
    private static final String TWITCH_URL = "https://www.twitch.tv";
    private static final String TWITCH_EMBED_BASE = "https://player.twitch.tv/?parent=localhost&channel=";

    // URL change detection
    private static String lastPolledUrl = "";
    private int pollTicks = 0;
    // Resize tracking
    private static int lastResizeW = 0, lastResizeH = 0;

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

        // Try Loom Browser Engine first, then MCEF Modern, then Classic MCEF
        if (tryInitLoom(url)) return;
        if (tryInitModern(url)) return;
        if (tryInitClassic(url)) return;

        statusMessage = "Browser mod is required (Loom Browser Engine or MCEF)";
        isMcefAvailable = false;
        isActive = true;
    }

    // ── Loom Browser Engine (com.loom.browser) ──

    private boolean tryInitLoom(String url) {
        try {
            Class<?> engineClass = Class.forName("com.loom.browser.LoomBrowserEngine");
            isMcefAvailable = true;
            isLoomEngine = true;
            isModernApi = false;

            Method isInit = engineClass.getMethod("isInitialized");
            boolean ready = (boolean) isInit.invoke(null);

            if (!ready) {
                // Trigger async initialization
                Method init = engineClass.getMethod("initialize");
                init.invoke(null);
                statusMessage = "Loom Browser Engine initializing...";
                isMcefInitialized = false;
                isActive = true;
                System.out.println("[Browser] Loom Browser Engine found, initializing...");
                return true;
            }

            isMcefInitialized = true;
            createBrowserLoom(engineClass, url);
            System.out.println("[Browser] Using Loom Browser Engine");
            return true;
        } catch (ClassNotFoundException e) {
            return false; // Loom Browser Engine not present
        } catch (Throwable e) {
            System.out.println("[Browser] Loom Browser Engine init error: " + e.getMessage());
            statusMessage = "Browser initializing...";
            isActive = true;
            return true;
        }
    }

    private static void createBrowserLoom(Class<?> engineClass, String url) {
        try {
            Method createBrowser = engineClass.getMethod("createBrowser", String.class, boolean.class);
            activeBrowser = createBrowser.invoke(null, url, false);
            if (activeBrowser == null) {
                statusMessage = "Browser creation returned null";
                System.out.println("[Browser] createBrowser (Loom) returned null!");
                return;
            }
            activeRenderer = null;
            isActive = true;
            isMcefInitialized = true;
            statusMessage = null;
            lastResizeW = 0;
            lastResizeH = 0;

            resizeBrowser();
            ensureBrowserFocus();
            System.out.println("[Browser] Created (Loom Engine): " + url);
        } catch (java.lang.reflect.InvocationTargetException e) {
            Throwable cause = e.getCause();
            statusMessage = "Browser creation failed";
            System.out.println("[Browser] createBrowser (Loom) failed with cause: " + 
                (cause != null ? cause.getClass().getName() + ": " + cause.getMessage() : "unknown"));
            if (cause != null) cause.printStackTrace();
        } catch (Exception e) {
            statusMessage = "Browser creation failed";
            System.out.println("[Browser] createBrowser (Loom) failed: " + e.getClass().getName() + ": " + e.getMessage());
            e.printStackTrace();
        }
    }

    // ── MCEF Modern (net.dimaskama.mcef.api) ──

    private boolean tryInitModern(String url) {
        try {
            Class<?> apiClass = Class.forName("net.dimaskama.mcef.api.MCEFApi");
            isMcefAvailable = true;
            isModernApi = true;

            // Check if already initialized via MCEFApi.getInstance()
            // Don't call initialize() ourselves — MCEF Modern handles its own init lifecycle
            Method getInstance = apiClass.getMethod("getInstance");
            Object api = getInstance.invoke(null);

            if (api == null) {
                // Not ready yet — MCEF Modern is still downloading/initializing CEF
                // Use getInstanceFuture() to detect when it's ready
                try {
                    Method getInstanceFuture = apiClass.getMethod("getInstanceFuture");
                    Object future = getInstanceFuture.invoke(null);
                    if (future != null) {
                        // Check if future is already done
                        Method isDone = future.getClass().getMethod("isDone");
                        boolean done = (boolean) isDone.invoke(future);
                        if (done) {
                            // Future completed — try getting API now
                            Method futureGet = future.getClass().getMethod("getNow", Object.class);
                            api = futureGet.invoke(future, (Object) null);
                        }
                    }
                } catch (Throwable ignored) {}

                if (api == null) {
                    statusMessage = "Browser is loading... (first launch takes a moment)";
                    isMcefInitialized = false;
                    isActive = true;
                    System.out.println("[Browser] MCEF Modern found but not yet initialized, waiting...");
                    return true;
                }
            }

            isMcefInitialized = true;
            createBrowserModern(api, url);
            System.out.println("[Browser] Using MCEF Modern API");
            return true;
        } catch (ClassNotFoundException e) {
            return false; // MCEF Modern not present, try Classic
        } catch (Throwable e) {
            // Catch ALL errors including native CEF crashes
            System.out.println("[Browser] MCEF Modern init error: " + e.getClass().getName() + ": " + e.getMessage());
            statusMessage = "Browser initializing...";
            isActive = true;
            return true;
        }
    }

    private static void createBrowserModern(Object api, String url) {
        try {
            Method createBrowser = api.getClass().getMethod("createBrowser", String.class, boolean.class);
            activeBrowser = createBrowser.invoke(api, url, false);
            activeRenderer = null; // Modern doesn't use a separate renderer
            isActive = true;
            isMcefInitialized = true;
            statusMessage = null;
            lastResizeW = 0;
            lastResizeH = 0;

            resizeBrowser();
            ensureBrowserFocus(); // CEF OSR requires explicit focus
            System.out.println("[Browser] Created (Modern): " + url);
        } catch (Exception e) {
            statusMessage = "Browser creation failed";
            System.out.println("[Browser] createBrowser (Modern) failed: " + e.getMessage());
        }
    }

    // ── Classic MCEF (com.cinemamod.mcef) ──

    private boolean tryInitClassic(String url) {
        try {
            Class<?> mcefClass = Class.forName("com.cinemamod.mcef.MCEF");
            isMcefAvailable = true;
            isModernApi = false;

            Method isInitialized = mcefClass.getMethod("isInitialized");
            isMcefInitialized = (boolean) isInitialized.invoke(null);

            if (!isMcefInitialized) {
                statusMessage = "MCEF is downloading browser libraries...";
                isActive = true;
                return true;
            }

            createBrowserClassic(url);
            System.out.println("[Browser] Using Classic MCEF API");
            return true;
        } catch (ClassNotFoundException e) {
            return false; // Classic MCEF not present either
        } catch (Exception e) {
            statusMessage = "Browser init failed: " + e.getMessage();
            isActive = true;
            return true;
        }
    }

    private static void createBrowserClassic(String url) {
        try {
            Class<?> mcefClass = Class.forName("com.cinemamod.mcef.MCEF");
            Method createBrowserMethod = mcefClass.getMethod("createBrowser", String.class, boolean.class);
            activeBrowser = createBrowserMethod.invoke(null, url, false);

            Method getRenderer = activeBrowser.getClass().getMethod("getRenderer");
            activeRenderer = getRenderer.invoke(activeBrowser);

            isActive = true;
            isMcefInitialized = true;
            statusMessage = null;
            lastResizeW = 0;
            lastResizeH = 0;

            resizeBrowser();
            System.out.println("[Browser] Created (Classic): " + url);
        } catch (Exception e) {
            statusMessage = "Browser creation failed";
            System.out.println("[Browser] createBrowser (Classic) failed: " + e.getMessage());
        }
    }

    // ── Shared browser operations ──

    public static void resizeBrowser() {
        if (activeBrowser == null) return;
        int scaleFactor = (int) MinecraftClient.getInstance().getWindow().getScaleFactor();
        int w = Math.max(browserW * scaleFactor, 200);
        int h = Math.max(browserH * scaleFactor, 200);
        w = Math.min(w, 1920);
        h = Math.min(h, 1080);
        if (w == lastResizeW && h == lastResizeH) return;
        lastResizeW = w;
        lastResizeH = h;
        try {
            Method resize = activeBrowser.getClass().getMethod("resize", int.class, int.class);
            resize.invoke(activeBrowser, w, h);
        } catch (Exception ignored) {}
    }

    /** Pre-warm browser engine on game startup */
    public static void preWarmMcef() {
        new Thread(() -> {
            try {
                Thread.sleep(3000);
                // Try Loom Browser Engine first
                try {
                    Class<?> engineClass = Class.forName("com.loom.browser.LoomBrowserEngine");
                    isMcefAvailable = true;
                    isLoomEngine = true;
                    isModernApi = false;
                    // Trigger initialization early
                    Method init = engineClass.getMethod("initialize");
                    init.invoke(null);
                    Method isInit = engineClass.getMethod("isInitialized");
                    isMcefInitialized = (boolean) isInit.invoke(null);
                    System.out.println("[Browser] Pre-warm: Loom Browser Engine available=" + isMcefAvailable + " initialized=" + isMcefInitialized);
                    return;
                } catch (ClassNotFoundException ignored) {}

                // Try Modern
                try {
                    Class<?> apiClass = Class.forName("net.dimaskama.mcef.api.MCEFApi");
                    isMcefAvailable = true;
                    isModernApi = true;
                    Method getInstance = apiClass.getMethod("getInstance");
                    Object api = getInstance.invoke(null);
                    isMcefInitialized = (api != null);
                    System.out.println("[Browser] Pre-warm: MCEF Modern available=" + isMcefAvailable + " initialized=" + isMcefInitialized);
                    return;
                } catch (ClassNotFoundException ignored) {}

                // Try Classic
                try {
                    Class<?> mcefClass = Class.forName("com.cinemamod.mcef.MCEF");
                    isMcefAvailable = true;
                    isModernApi = false;
                    Method isInit = mcefClass.getMethod("isInitialized");
                    isMcefInitialized = (boolean) isInit.invoke(null);
                    System.out.println("[Browser] Pre-warm: Classic MCEF available=" + isMcefAvailable + " initialized=" + isMcefInitialized);
                    return;
                } catch (ClassNotFoundException ignored) {}

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

    // ── Input Forwarding ──────────

    // AWT event constants
    private static final int AWT_MOUSE_PRESSED = java.awt.event.MouseEvent.MOUSE_PRESSED;
    private static final int AWT_MOUSE_RELEASED = java.awt.event.MouseEvent.MOUSE_RELEASED;
    private static final int AWT_MOUSE_MOVED = java.awt.event.MouseEvent.MOUSE_MOVED;
    private static final int AWT_MOUSE_DRAGGED = java.awt.event.MouseEvent.MOUSE_DRAGGED;
    private static final int AWT_KEY_PRESSED = java.awt.event.KeyEvent.KEY_PRESSED;
    private static final int AWT_KEY_RELEASED = java.awt.event.KeyEvent.KEY_RELEASED;
    private static final int AWT_KEY_TYPED = java.awt.event.KeyEvent.KEY_TYPED;
    private static boolean mouseButtonDown = false;
    private static int heldAwtButton = 0;

    /** Dummy AWT component for creating events when no real component exists */
    private static final java.awt.Component DUMMY_COMPONENT = new java.awt.Canvas();

    /** Get the AWT Component from the CefBrowser for creating events */
    private static java.awt.Component getCefComponent() {
        if (activeBrowser == null) return DUMMY_COMPONENT;
        try {
            Method getCef = activeBrowser.getClass().getMethod("getCefBrowser");
            Object cef = getCef.invoke(activeBrowser);
            if (cef != null) {
                Method getUI = cef.getClass().getMethod("getUIComponent");
                java.awt.Component comp = (java.awt.Component) getUI.invoke(cef);
                return comp != null ? comp : DUMMY_COMPONENT;
            }
        } catch (Exception ignored) {}
        return DUMMY_COMPONENT;
    }

    /** Find a method by walking up the class hierarchy */
    private static Method findMethod(Class<?> clazz, String name, Class<?>... paramTypes) {
        Class<?> c = clazz;
        while (c != null) {
            try {
                Method m = c.getDeclaredMethod(name, paramTypes);
                m.setAccessible(true);
                return m;
            } catch (NoSuchMethodException e) {
                c = c.getSuperclass();
            }
        }
        return null;
    }

    /** Send a raw AWT MouseEvent to the CefBrowser */
    private static void sendCefMouseEvent(java.awt.event.MouseEvent evt) {
        if (activeBrowser == null) return;
        try {
            Method getCef = activeBrowser.getClass().getMethod("getCefBrowser");
            Object cef = getCef.invoke(activeBrowser);
            if (cef != null) {
                if (evt instanceof java.awt.event.MouseWheelEvent) {
                    Method send = findMethod(cef.getClass(), "sendMouseWheelEvent", java.awt.event.MouseWheelEvent.class);
                    if (send != null) {
                        send.invoke(cef, evt);
                    }
                } else {
                    Method send = findMethod(cef.getClass(), "sendMouseEvent", java.awt.event.MouseEvent.class);
                    if (send != null) {
                        send.invoke(cef, evt);
                    }
                }
            }
        } catch (Exception e) {
            System.out.println("[Browser] sendCefMouseEvent error: " + e.getMessage());
        }
    }

    /** Send a raw AWT KeyEvent directly to CefBrowser.sendKeyEvent (NOT through AWT component) */
    private static void sendCefKeyEvent(java.awt.event.KeyEvent evt) {
        if (activeBrowser == null) return;
        try {
            Method getCef = activeBrowser.getClass().getMethod("getCefBrowser");
            Object cef = getCef.invoke(activeBrowser);
            if (cef != null) {
                // ALWAYS use cef.sendKeyEvent() directly — NOT comp.dispatchEvent()
                // In OSR mode, dispatchEvent goes to a Canvas with no CEF bridge
                Method send = findMethod(cef.getClass(), "sendKeyEvent", java.awt.event.KeyEvent.class);
                if (send != null) {
                    send.invoke(cef, evt);
                }
            }
        } catch (Exception e) {
            System.out.println("[Browser] sendCefKeyEvent error: " + e.getMessage());
        }
    }

    /** Tell CEF that the browser has keyboard focus (required for OSR mode) */
    private static void ensureBrowserFocus() {
        if (activeBrowser == null) return;
        try {
            Method getCef = activeBrowser.getClass().getMethod("getCefBrowser");
            Object cef = getCef.invoke(activeBrowser);
            if (cef != null) {
                Method setFocus = findMethod(cef.getClass(), "setFocus", boolean.class);
                if (setFocus != null) {
                    setFocus.invoke(cef, true);
                }
            }
        } catch (Exception ignored) {}
    }

    /** Convert GLFW mouse button to AWT button */
    private static int toAwtButton(int glfwButton) {
        switch (glfwButton) {
            case 0: return java.awt.event.MouseEvent.BUTTON1;
            case 1: return java.awt.event.MouseEvent.BUTTON3; // right
            case 2: return java.awt.event.MouseEvent.BUTTON2; // middle
            default: return java.awt.event.MouseEvent.BUTTON1;
        }
    }

    /** Convert GLFW key code to AWT key code */
    private static int toAwtKeyCode(int glfwKey) {
        switch (glfwKey) {
            case GLFW.GLFW_KEY_BACKSPACE: return java.awt.event.KeyEvent.VK_BACK_SPACE;
            case GLFW.GLFW_KEY_ENTER: return java.awt.event.KeyEvent.VK_ENTER;
            case GLFW.GLFW_KEY_TAB: return java.awt.event.KeyEvent.VK_TAB;
            case GLFW.GLFW_KEY_DELETE: return java.awt.event.KeyEvent.VK_DELETE;
            case GLFW.GLFW_KEY_LEFT: return java.awt.event.KeyEvent.VK_LEFT;
            case GLFW.GLFW_KEY_RIGHT: return java.awt.event.KeyEvent.VK_RIGHT;
            case GLFW.GLFW_KEY_UP: return java.awt.event.KeyEvent.VK_UP;
            case GLFW.GLFW_KEY_DOWN: return java.awt.event.KeyEvent.VK_DOWN;
            case GLFW.GLFW_KEY_HOME: return java.awt.event.KeyEvent.VK_HOME;
            case GLFW.GLFW_KEY_END: return java.awt.event.KeyEvent.VK_END;
            case GLFW.GLFW_KEY_PAGE_UP: return java.awt.event.KeyEvent.VK_PAGE_UP;
            case GLFW.GLFW_KEY_PAGE_DOWN: return java.awt.event.KeyEvent.VK_PAGE_DOWN;
            case GLFW.GLFW_KEY_LEFT_SHIFT: case GLFW.GLFW_KEY_RIGHT_SHIFT: return java.awt.event.KeyEvent.VK_SHIFT;
            case GLFW.GLFW_KEY_LEFT_CONTROL: case GLFW.GLFW_KEY_RIGHT_CONTROL: return java.awt.event.KeyEvent.VK_CONTROL;
            case GLFW.GLFW_KEY_LEFT_ALT: case GLFW.GLFW_KEY_RIGHT_ALT: return java.awt.event.KeyEvent.VK_ALT;
            case GLFW.GLFW_KEY_A: return java.awt.event.KeyEvent.VK_A;
            case GLFW.GLFW_KEY_C: return java.awt.event.KeyEvent.VK_C;
            case GLFW.GLFW_KEY_V: return java.awt.event.KeyEvent.VK_V;
            case GLFW.GLFW_KEY_X: return java.awt.event.KeyEvent.VK_X;
            case GLFW.GLFW_KEY_Z: return java.awt.event.KeyEvent.VK_Z;
            case GLFW.GLFW_KEY_F5: return java.awt.event.KeyEvent.VK_F5;
            default:
                // For letter keys A-Z (GLFW uses same values as ASCII)
                if (glfwKey >= GLFW.GLFW_KEY_A && glfwKey <= GLFW.GLFW_KEY_Z) {
                    return java.awt.event.KeyEvent.VK_A + (glfwKey - GLFW.GLFW_KEY_A);
                }
                // For number keys 0-9
                if (glfwKey >= GLFW.GLFW_KEY_0 && glfwKey <= GLFW.GLFW_KEY_9) {
                    return java.awt.event.KeyEvent.VK_0 + (glfwKey - GLFW.GLFW_KEY_0);
                }
                return glfwKey;
        }
    }

    /** Convert GLFW modifiers to AWT modifiers */
    private static int toAwtModifiers(int glfwMods) {
        int awt = 0;
        if ((glfwMods & GLFW.GLFW_MOD_SHIFT) != 0) awt |= java.awt.event.InputEvent.SHIFT_DOWN_MASK;
        if ((glfwMods & GLFW.GLFW_MOD_CONTROL) != 0) awt |= java.awt.event.InputEvent.CTRL_DOWN_MASK;
        if ((glfwMods & GLFW.GLFW_MOD_ALT) != 0) awt |= java.awt.event.InputEvent.ALT_DOWN_MASK;
        return awt;
    }

    @Override
    public boolean mouseClicked(Click click, boolean bl) {
        double mouseX = click.x();
        double mouseY = click.y();

        if (activeMode == Mode.MEDIA && mouseY < browserY && mouseY >= panelY) {
            TwitchScreen.clickPending = true;
            TwitchScreen.clickX = (int) mouseX;
            TwitchScreen.clickY = (int) mouseY;
            return true;
        }
        if (activeBrowser != null && isInBrowserArea(mouseX, mouseY)) {
            if (isModernApi) {
                ensureBrowserFocus(); // Ensure CEF knows it has focus on click
                java.awt.Component comp = getCefComponent();
                if (comp != null) {
                    int sx = scaledX(mouseX), sy = scaledY(mouseY);
                    int btn = toAwtButton(click.button());
                    int btnMask = java.awt.event.InputEvent.getMaskForButton(btn);
                    mouseButtonDown = true;
                    heldAwtButton = btn;
                    sendCefMouseEvent(new java.awt.event.MouseEvent(comp, AWT_MOUSE_PRESSED,
                        System.currentTimeMillis(), btnMask, sx, sy, 1, false, btn));
                }
            } else {
                try {
                    Method m = activeBrowser.getClass().getMethod("sendMousePress", int.class, int.class, int.class);
                    m.invoke(activeBrowser, scaledX(mouseX), scaledY(mouseY), click.button());
                } catch (Exception ignored) {}
            }
            return true;
        }
        return super.mouseClicked(click, bl);
    }

    @Override
    public boolean mouseReleased(Click click) {
        if (activeBrowser != null) {
            if (isModernApi) {
                java.awt.Component comp = getCefComponent();
                if (comp != null) {
                    int sx = scaledX(click.x()), sy = scaledY(click.y());
                    int btn = toAwtButton(click.button());
                    mouseButtonDown = false;
                    heldAwtButton = 0;
                    sendCefMouseEvent(new java.awt.event.MouseEvent(comp, AWT_MOUSE_RELEASED,
                        System.currentTimeMillis(), 0, sx, sy, 1, false, btn));
                }
            } else {
                try {
                    Method m = activeBrowser.getClass().getMethod("sendMouseRelease", int.class, int.class, int.class);
                    m.invoke(activeBrowser, scaledX(click.x()), scaledY(click.y()), click.button());
                } catch (Exception ignored) {}
            }
        }
        return true;
    }

    @Override
    public void mouseMoved(double mouseX, double mouseY) {
        if (activeBrowser != null) {
            long now = System.nanoTime();
            if (now - lastMouseMoveNanos < MOUSE_MOVE_INTERVAL_NS) return;
            lastMouseMoveNanos = now;
            if (isModernApi) {
                java.awt.Component comp = getCefComponent();
                if (comp != null) {
                    int eventType = mouseButtonDown ? AWT_MOUSE_DRAGGED : AWT_MOUSE_MOVED;
                    int mods = mouseButtonDown ? java.awt.event.InputEvent.getMaskForButton(heldAwtButton) : 0;
                    sendCefMouseEvent(new java.awt.event.MouseEvent(comp, eventType,
                        System.currentTimeMillis(), mods, scaledX(mouseX), scaledY(mouseY), 0, false));
                }
            } else {
                try {
                    Method m = activeBrowser.getClass().getMethod("sendMouseMove", int.class, int.class);
                    m.invoke(activeBrowser, scaledX(mouseX), scaledY(mouseY));
                } catch (Exception ignored) {}
            }
        }
    }

    @Override
    public boolean mouseScrolled(double mouseX, double mouseY, double hAmount, double vAmount) {
        if (activeBrowser != null && isInBrowserArea(mouseX, mouseY)) {
            if (isModernApi) {
                // Use MCEFBrowserImpl's own scroll method which properly handles
                // the coordinate scaling and CEF scroll event creation
                try {
                    Method m = activeBrowser.getClass().getMethod("onMouseScrolled", int.class, int.class, double.class);
                    m.invoke(activeBrowser, scaledX(mouseX), scaledY(mouseY), vAmount);
                } catch (Exception e) {
                    // Fallback: send raw AWT event directly to CefBrowser
                    try {
                        java.awt.Component comp = getCefComponent();
                        if (comp != null) {
                            int scroll = (int)(vAmount * 3);
                            java.awt.event.MouseWheelEvent wheelEvt = new java.awt.event.MouseWheelEvent(comp,
                                java.awt.event.MouseEvent.MOUSE_WHEEL, System.currentTimeMillis(), 0,
                                scaledX(mouseX), scaledY(mouseY), 0, false,
                                java.awt.event.MouseWheelEvent.WHEEL_UNIT_SCROLL, scroll, scroll);
                            Method getCef = activeBrowser.getClass().getMethod("getCefBrowser");
                            Object cef = getCef.invoke(activeBrowser);
                            if (cef != null) {
                                Method send = findMethod(cef.getClass(), "sendMouseWheelEvent", java.awt.event.MouseWheelEvent.class);
                                if (send != null) send.invoke(cef, wheelEvt);
                            }
                        }
                    } catch (Exception ignored) {}
                }
            } else {
                try {
                    Method m = activeBrowser.getClass().getMethod("sendMouseWheel", int.class, int.class, double.class, int.class);
                    m.invoke(activeBrowser, scaledX(mouseX), scaledY(mouseY), vAmount, 0);
                } catch (Exception ignored) {}
            }
            return true;
        }
        return super.mouseScrolled(mouseX, mouseY, hAmount, vAmount);
    }

    @Override
    public boolean keyPressed(KeyInput keyInput) {
        int keyCode = keyInput.key();

        if (keyCode == GLFW.GLFW_KEY_ESCAPE) {
            close();
            return true;
        }
        if (activeBrowser != null) {
            // Ensure CEF knows it has focus on every keystroke (OSR can lose focus)
            ensureBrowserFocus();

            if (isModernApi) {
                // Bypass MCEFBrowserImpl entirely — send events directly to CefBrowser
                // CEF requires: RAWKEYDOWN (KEY_PRESSED) + CHAR (KEY_TYPED) + KEYUP (KEY_RELEASED)
                java.awt.Component comp = getCefComponent();
                if (comp == null) {
                    comp = new java.awt.Canvas(); // Dummy component for AWT event construction
                }
                int awtKey = toAwtKeyCode(keyCode);
                int awtMods = toAwtModifiers(keyInput.modifiers());
                long now = System.currentTimeMillis();

                // 1. KEY_PRESSED → CEF RAWKEYDOWN
                java.awt.event.KeyEvent pressed = new java.awt.event.KeyEvent(
                    comp, java.awt.event.KeyEvent.KEY_PRESSED,
                    now, awtMods, awtKey, java.awt.event.KeyEvent.CHAR_UNDEFINED);
                sendCefKeyEvent(pressed);

                // 2. KEY_TYPED → CEF CHAR (for action keys that Minecraft won't fire charTyped for)
                // CEF on Windows expects \r (carriage return, 13) for Enter, not \n (10)
                char actionChar = 0;
                if (keyCode == GLFW.GLFW_KEY_BACKSPACE) actionChar = '\b';
                else if (keyCode == GLFW.GLFW_KEY_ENTER || keyCode == GLFW.GLFW_KEY_KP_ENTER) actionChar = '\r';
                else if (keyCode == GLFW.GLFW_KEY_TAB) actionChar = '\t';
                else if (keyCode == GLFW.GLFW_KEY_DELETE) actionChar = (char) 127;

                if (actionChar != 0) {
                    java.awt.event.KeyEvent typed = new java.awt.event.KeyEvent(
                        comp, java.awt.event.KeyEvent.KEY_TYPED,
                        now, awtMods,
                        java.awt.event.KeyEvent.VK_UNDEFINED, actionChar);
                    sendCefKeyEvent(typed);
                }

                // 3. KEY_RELEASED immediately for action keys (CEF needs full cycle)
                if (actionChar != 0) {
                    java.awt.event.KeyEvent released = new java.awt.event.KeyEvent(
                        comp, java.awt.event.KeyEvent.KEY_RELEASED,
                        now + 1, awtMods, awtKey,
                        java.awt.event.KeyEvent.CHAR_UNDEFINED);
                    sendCefKeyEvent(released);
                }

                // ── JS fallback for keys that CEF OSR drops (missing native scancode) ──
                if (keyCode == GLFW.GLFW_KEY_BACKSPACE) {
                    executeJavaScript(
                        "(function(){" +
                        "var el=document.activeElement;" +
                        "if(el&&(el.tagName==='INPUT'||el.tagName==='TEXTAREA')){" +
                        "  var s=el.selectionStart,e=el.selectionEnd;" +
                        "  if(s===e&&s>0){el.setRangeText('',s-1,e,'end');" +
                        "  el.dispatchEvent(new Event('input',{bubbles:true}));}" +
                        "  else if(s!==e){el.setRangeText('',s,e,'end');" +
                        "  el.dispatchEvent(new Event('input',{bubbles:true}));}" +
                        "}else{document.execCommand('delete',false);}" +
                        "})();"
                    );
                }
                if (keyCode == GLFW.GLFW_KEY_DELETE) {
                    executeJavaScript(
                        "(function(){" +
                        "var el=document.activeElement;" +
                        "if(el&&(el.tagName==='INPUT'||el.tagName==='TEXTAREA')){" +
                        "  var s=el.selectionStart,e=el.selectionEnd;" +
                        "  if(s===e&&s<el.value.length){el.setRangeText('',s,e+1,'end');" +
                        "  el.dispatchEvent(new Event('input',{bubbles:true}));}" +
                        "  else if(s!==e){el.setRangeText('',s,e,'end');" +
                        "  el.dispatchEvent(new Event('input',{bubbles:true}));}" +
                        "}else{document.execCommand('forwardDelete',false);}" +
                        "})();"
                    );
                }
                if (keyCode == GLFW.GLFW_KEY_LEFT) {
                    executeJavaScript(
                        "(function(){var el=document.activeElement;" +
                        "if(el&&el.selectionStart!==undefined){" +
                        "el.selectionStart=el.selectionEnd=Math.max(0,el.selectionStart-1);}})();"
                    );
                }
                if (keyCode == GLFW.GLFW_KEY_RIGHT) {
                    executeJavaScript(
                        "(function(){var el=document.activeElement;" +
                        "if(el&&el.selectionStart!==undefined){" +
                        "el.selectionStart=el.selectionEnd=Math.min(el.value.length,el.selectionEnd+1);}})();"
                    );
                }
                if (keyCode == GLFW.GLFW_KEY_HOME) {
                    executeJavaScript(
                        "(function(){var el=document.activeElement;" +
                        "if(el&&el.selectionStart!==undefined){el.selectionStart=el.selectionEnd=0;}})();"
                    );
                }
                if (keyCode == GLFW.GLFW_KEY_END) {
                    executeJavaScript(
                        "(function(){var el=document.activeElement;" +
                        "if(el&&el.selectionStart!==undefined){el.selectionStart=el.selectionEnd=el.value.length;}})();"
                    );
                }
            } else {
                try {
                    Method m = activeBrowser.getClass().getMethod("sendKeyPress", int.class, long.class, int.class);
                    m.invoke(activeBrowser, keyInput.key(), (long) keyInput.scancode(), keyInput.modifiers());
                } catch (Exception ignored) {}
            }
            return true;
        }
        return super.keyPressed(keyInput);
    }

    @Override
    public boolean keyReleased(KeyInput keyInput) {
        if (activeBrowser != null) {
            if (isModernApi) {
                // Send KEY_RELEASED directly to CefBrowser
                java.awt.Component comp = getCefComponent();
                if (comp == null) comp = new java.awt.Canvas();
                int awtKey = toAwtKeyCode(keyInput.key());
                int awtMods = toAwtModifiers(keyInput.modifiers());

                java.awt.event.KeyEvent released = new java.awt.event.KeyEvent(
                    comp, java.awt.event.KeyEvent.KEY_RELEASED,
                    System.currentTimeMillis(), awtMods, awtKey,
                    java.awt.event.KeyEvent.CHAR_UNDEFINED);
                sendCefKeyEvent(released);
            } else {
                try {
                    Method m = activeBrowser.getClass().getMethod("sendKeyRelease", int.class, long.class, int.class);
                    m.invoke(activeBrowser, keyInput.key(), (long) keyInput.scancode(), keyInput.modifiers());
                } catch (Exception ignored) {}
            }
        }
        return super.keyReleased(keyInput);
    }

    @Override
    public boolean charTyped(CharInput charInput) {
        if (activeBrowser != null) {
            if (isModernApi) {
                // Send KEY_TYPED directly to CefBrowser for printable characters
                java.awt.Component comp = getCefComponent();
                if (comp == null) comp = new java.awt.Canvas();

                java.awt.event.KeyEvent typed = new java.awt.event.KeyEvent(
                    comp, java.awt.event.KeyEvent.KEY_TYPED,
                    System.currentTimeMillis(), toAwtModifiers(charInput.modifiers()),
                    java.awt.event.KeyEvent.VK_UNDEFINED, (char) charInput.codepoint());
                sendCefKeyEvent(typed);
            } else {
                try {
                    Method m = activeBrowser.getClass().getMethod("sendKeyTyped", char.class, int.class);
                    m.invoke(activeBrowser, (char) charInput.codepoint(), charInput.modifiers());
                } catch (Exception ignored) {}
            }
            return true;
        }
        return super.charTyped(charInput);
    }

    // ── Coordinate Helpers ────────────────────────────

    private int scaledX(double mouseX) {
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
        // Block Twitch on MCEF Modern (no H.264 codec support)
        if ("twitch".equals(tab) && !isTwitchSupported()) return;
        activeTab = tab;
        loadUrl("youtube".equals(tab) ? YOUTUBE_URL : TWITCH_URL);
    }

    /**
     * Twitch requires H.264 codecs which are only available in Classic MCEF.
     * MCEF Modern uses a CEF build without proprietary codecs.
     */
    public static boolean isTwitchSupported() {
        return !isModernApi; // Classic MCEF has H.264, Modern does not
    }

    public static void loadUrl(String url) {
        if (activeMode == Mode.GENERAL && ContentFilter.isBlocked(url)) {
            blockedMessage = ContentFilter.getBlockReason(url);
            blockedMessageUntil = System.currentTimeMillis() + 3000;
            return;
        }

        if (activeBrowser != null) {
            try {
                if (isModernApi) {
                    // MCEF Modern: access CefBrowser and loadURL
                    Method getCef = activeBrowser.getClass().getMethod("getCefBrowser");
                    Object cef = getCef.invoke(activeBrowser);
                    if (cef != null) {
                        Method loadURL = cef.getClass().getMethod("loadURL", String.class);
                        loadURL.invoke(cef, url);
                    }
                } else {
                    Method loadURL = activeBrowser.getClass().getMethod("loadURL", String.class);
                    loadURL.invoke(activeBrowser, url);
                }
            } catch (Exception ignored) {}

            // Inject Twitch fix after navigation to handle parent parameter issue
            if (url.contains("twitch.tv")) {
                injectTwitchFix();
            }
        }
    }

    /**
     * Convert a Twitch channel URL to an embed player URL.
     * Returns null if the URL is not a Twitch channel page.
     * Examples:
     *   twitch.tv/xqc         → player.twitch.tv/?parent=localhost&channel=xqc
     *   twitch.tv/            → null (homepage, keep as-is for browsing)
     *   twitch.tv/directory   → null (directory, keep as-is)
     *   player.twitch.tv/...  → null (already embed)
     */
    private static String toTwitchEmbed(String url) {
        if (url == null || url.contains("player.twitch.tv")) return null;
        if (!url.contains("twitch.tv/")) return null;

        try {
            String path = url.substring(url.indexOf("twitch.tv/") + 10);
            // Remove query string and fragment
            if (path.contains("?")) path = path.substring(0, path.indexOf("?"));
            if (path.contains("#")) path = path.substring(0, path.indexOf("#"));
            // Remove trailing slash
            if (path.endsWith("/")) path = path.substring(0, path.length() - 1);

            // Skip non-channel pages
            if (path.isEmpty()) return null;
            if (path.startsWith("directory")) return null;
            if (path.startsWith("settings")) return null;
            if (path.startsWith("downloads")) return null;
            if (path.startsWith("search")) return null;
            if (path.startsWith("subscriptions")) return null;
            if (path.startsWith("wallet")) return null;
            if (path.startsWith("u/")) return null;
            if (path.contains("/")) return null; // sub-pages like /channelName/clips

            // It's a channel name — redirect to embed player
            System.out.println("[Browser] Twitch: redirecting to embed player for channel: " + path);
            return TWITCH_EMBED_BASE + path;
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Inject JavaScript into the browser to fix Twitch playback issues.
     * Twitch's native page uses an embedded player that may need user interaction
     * to start playing (mature content warnings, autoplay blocks, etc.)
     * We inject JS after a delay to dismiss these overlays automatically.
     */
    private static void injectTwitchFix() {
        new Thread(() -> {
            try {
                Thread.sleep(3000); // Wait for page to load
                // Dismiss mature content / "Start Watching" overlays
                executeJavaScript(
                    "(function() {" +
                    "  try {" +
                    "    // Click 'Start Watching' button on mature content warning" +
                    "    var btns = document.querySelectorAll('[data-a-target=\"content-classification-gate-overlay-start-watching-button\"]');" +
                    "    btns.forEach(function(b) { b.click(); });" +
                    "    // Also try generic accept buttons" +
                    "    var accept = document.querySelectorAll('button[data-a-target=\"player-overlay-mature-accept\"]');" +
                    "    accept.forEach(function(b) { b.click(); });" +
                    "    // Try to unmute" +
                    "    var muteBtn = document.querySelector('[data-a-target=\"player-mute-unmute-button\"]');" +
                    "    if (muteBtn) {" +
                    "      var vol = muteBtn.getAttribute('aria-label');" +
                    "      if (vol && vol.toLowerCase().includes('unmute')) muteBtn.click();" +
                    "    }" +
                    "    // Click play if paused" +
                    "    var playBtn = document.querySelector('[data-a-target=\"player-play-pause-button\"]');" +
                    "    if (playBtn) {" +
                    "      var label = playBtn.getAttribute('aria-label');" +
                    "      if (label && label.toLowerCase().includes('play')) playBtn.click();" +
                    "    }" +
                    "  } catch(e) {}" +
                    "})();"
                );
                System.out.println("[Browser] Twitch: injected playback fix JS");
            } catch (InterruptedException ignored) {}
        }, "Twitch-Fix").start();
    }

    /**
     * Execute JavaScript in the current browser page.
     * Uses CefBrowser.executeJavaScript() via reflection.
     */
    public static void executeJavaScript(String script) {
        if (activeBrowser == null) return;
        try {
            if (isModernApi) {
                Method getCef = activeBrowser.getClass().getMethod("getCefBrowser");
                Object cef = getCef.invoke(activeBrowser);
                if (cef != null) {
                    Method execJS = findMethod(cef.getClass(), "executeJavaScript", String.class, String.class, int.class);
                    if (execJS != null) {
                        execJS.invoke(cef, script, "", 0);
                    }
                }
            } else {
                // Classic MCEF — try MCEFBrowser.executeJavaScript
                Method execJS = findMethod(activeBrowser.getClass(), "executeJavascript", String.class, String.class, int.class);
                if (execJS != null) {
                    execJS.invoke(activeBrowser, script, "", 0);
                }
            }
        } catch (Exception e) {
            System.out.println("[Browser] executeJavaScript error: " + e.getMessage());
        }
    }

    /** Get browser texture ID (Classic MCEF or Loom Browser Engine) */
    public static int getTextureID() {
        if (activeBrowser == null) return 0;

        // Loom Browser Engine — call uploadTexture() first, then getGlTextureId()
        if (isLoomEngine) {
            try {
                Method upload = activeBrowser.getClass().getMethod("uploadTexture");
                upload.invoke(activeBrowser);
                Method getTexId = activeBrowser.getClass().getMethod("getGlTextureId");
                return (int) getTexId.invoke(activeBrowser);
            } catch (Exception e) { return 0; }
        }

        // Classic MCEF
        if (isModernApi) return 0;
        try {
            if (activeRenderer == null) return 0;
            Method getTextureID = activeRenderer.getClass().getMethod("getTextureID");
            return (int) getTextureID.invoke(activeRenderer);
        } catch (Exception e) { return 0; }
    }

    /** Get browser GpuTextureView (MCEF Modern only) — returns null if not available */
    public static Object getBrowserTextureView() {
        if (activeBrowser == null || !isModernApi) return null;
        try {
            Method getTextureView = activeBrowser.getClass().getMethod("getTextureView");
            return getTextureView.invoke(activeBrowser);
        } catch (Exception e) { return null; }
    }

    /**
     * Update the registered BrowserTexture with MCEF Modern's current GPU texture.
     * Returns true if the texture is ready to render.
     */
    public static boolean updateBrowserTexture() {
        if (activeBrowser == null || !isModernApi) return false;
        try {
            Method getTexture = activeBrowser.getClass().getMethod("getTexture");
            Object gpuTexture = getTexture.invoke(activeBrowser);
            Method getTextureView = activeBrowser.getClass().getMethod("getTextureView");
            Object gpuTextureView = getTextureView.invoke(activeBrowser);

            if (gpuTexture == null || gpuTextureView == null) return false;

            // Register or update BrowserTexture with TextureManager
            net.minecraft.client.texture.TextureManager texMgr = MinecraftClient.getInstance().getTextureManager();
            net.minecraft.util.Identifier browserId = net.minecraft.util.Identifier.of("cobble", "mcef_browser");

            net.minecraft.client.texture.AbstractTexture existing = texMgr.getTexture(browserId);
            BrowserTexture browserTex;
            if (existing instanceof BrowserTexture) {
                browserTex = (BrowserTexture) existing;
            } else {
                browserTex = new BrowserTexture();
                texMgr.registerTexture(browserId, browserTex);
                System.out.println("[Browser] Registered BrowserTexture with TextureManager");
            }

            browserTex.updateFrom(
                (com.mojang.blaze3d.textures.GpuTexture) gpuTexture,
                (com.mojang.blaze3d.textures.GpuTextureView) gpuTextureView
            );
            return true;
        } catch (Exception e) {
            if (browserDebugLogged < 3) {
                browserDebugLogged++;
                System.out.println("[Browser] updateBrowserTexture error: " + e.getClass().getName() + ": " + e.getMessage());
                e.printStackTrace();
            }
            return false;
        }
    }
    private static int browserDebugLogged = 0;

    /** Check if using MCEF Modern API (not Loom Engine, not Classic) */
    public static boolean isUsingModernApi() {
        return isModernApi && !isLoomEngine;
    }

    /** Check if using Loom Browser Engine */
    public static boolean isUsingLoomEngine() {
        return isLoomEngine;
    }

    /** Get current browser URL */
    public static String getCurrentUrl() {
        if (activeBrowser == null) return "";
        try {
            if (isModernApi) {
                Method getCef = activeBrowser.getClass().getMethod("getCefBrowser");
                Object cef = getCef.invoke(activeBrowser);
                if (cef != null) {
                    Method getURL = cef.getClass().getMethod("getURL");
                    String url = (String) getURL.invoke(cef);
                    return url != null ? url : "";
                }
                return "";
            } else {
                Method getURL = activeBrowser.getClass().getMethod("getURL");
                String url = (String) getURL.invoke(activeBrowser);
                return url != null ? url : "";
            }
        } catch (Exception e) { return ""; }
    }

    @Override
    public void tick() {
        super.tick();

        // If MCEF was downloading, check if ready now
        if (isMcefAvailable && !isMcefInitialized) {
            try {
                if (isModernApi) {
                    Class<?> apiClass = Class.forName("net.dimaskama.mcef.api.MCEFApi");
                    Method getInstance = apiClass.getMethod("getInstance");
                    Object api = getInstance.invoke(null);
                    if (api != null) {
                        isMcefInitialized = true;
                        if (activeBrowser == null) {
                            String url = activeMode == Mode.MEDIA ? YOUTUBE_URL : "https://www.google.com";
                            createBrowserModern(api, url);
                        }
                    }
                } else {
                    Class<?> mcefClass = Class.forName("com.cinemamod.mcef.MCEF");
                    Method isInit = mcefClass.getMethod("isInitialized");
                    isMcefInitialized = (boolean) isInit.invoke(null);
                    if (isMcefInitialized && activeBrowser == null) {
                        String url = activeMode == Mode.MEDIA ? YOUTUBE_URL : "https://www.google.com";
                        createBrowserClassic(url);
                    }
                }
            } catch (Exception ignored) {}
        }

        // Poll for URL changes
        pollTicks++;
        if (activeBrowser != null && pollTicks % 20 == 0) {
            String currentUrl = getCurrentUrl();
            if (currentUrl != null && !currentUrl.equals(lastPolledUrl)) {
                lastPolledUrl = currentUrl;

                // General mode: content filter
                if (activeMode == Mode.GENERAL && ContentFilter.isBlocked(currentUrl)) {
                    blockedMessage = ContentFilter.getBlockReason(currentUrl);
                    blockedMessageUntil = System.currentTimeMillis() + 3000;
                    loadUrl("https://www.google.com");
                }

                // Twitch: inject JS fix when navigating to a channel page
                if (activeMode == Mode.MEDIA && currentUrl.contains("twitch.tv/")
                        && !currentUrl.endsWith("twitch.tv/")
                        && !currentUrl.contains("/directory")) {
                    injectTwitchFix();
                }
            }
        }
    }

    @Override
    public void close() {
        if (activeMode == Mode.MEDIA && activeBrowser != null) {
            String url = getCurrentUrl();
            boolean isVideoPage = url.contains("youtube.com/watch") || url.contains("youtu.be/")
                || (url.contains("twitch.tv/") && !url.endsWith("twitch.tv/") && !url.contains("/directory"))
                || url.contains("player.twitch.tv");
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
            try {
                Method close = activeBrowser.getClass().getMethod("close");
                close.invoke(activeBrowser);
            } catch (Exception ignored) {}
            activeBrowser = null;
            activeRenderer = null;
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
