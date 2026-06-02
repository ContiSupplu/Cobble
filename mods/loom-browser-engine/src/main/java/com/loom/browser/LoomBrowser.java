package com.loom.browser;

import org.cef.CefClient;
import org.cef.browser.CefBrowser;
import org.cef.browser.CefPaintEvent;
import org.cef.handler.CefRenderHandler;

import java.nio.ByteBuffer;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

/**
 * A single browser instance wrapping a JCEF CefBrowser in OSR mode.
 * <p>
 * Uses the CefRenderHandler's {@code addOnPaintListener} API to receive
 * rendered frames from CEF and upload them to an OpenGL texture for
 * Minecraft rendering.
 * <p>
 * Public API (detected by InGameBrowser via reflection):
 * <ul>
 *   <li>{@link #getCefBrowser()} — raw CefBrowser for input events</li>
 *   <li>{@link #resize(int, int)} — resize viewport</li>
 *   <li>{@link #loadURL(String)} — navigate</li>
 *   <li>{@link #getURL()} — current URL</li>
 *   <li>{@link #close()} — destroy browser</li>
 *   <li>{@link #getGlTextureId()} — OpenGL texture for rendering</li>
 *   <li>{@link #uploadTexture()} — upload pixels to GL (call on render thread)</li>
 * </ul>
 */
public class LoomBrowser {

    private final CefBrowser cefBrowser;
    private final Consumer<CefPaintEvent> paintListener;

    // Pixel buffer from CEF (BGRA format)
    private ByteBuffer pixelBuffer;
    private int paintWidth = 0;
    private int paintHeight = 0;
    private final AtomicBoolean needsUpload = new AtomicBoolean(false);
    private final Object bufferLock = new Object();

    // OpenGL texture
    private int glTextureId = 0;
    private int textureWidth = 0;
    private int textureHeight = 0;

    // Requested viewport size
    private volatile int viewportWidth = 800;
    private volatile int viewportHeight = 600;

    public LoomBrowser(CefClient client, String url, boolean transparent) {
        System.out.println("[Loom Browser] Creating browser for: " + url);
        System.out.println("[Loom Browser] Thread: " + Thread.currentThread().getName());

        // JCEF needs AWT even in OSR mode — Minecraft sets headless=true which breaks it
        String wasHeadless = System.getProperty("java.awt.headless");
        System.setProperty("java.awt.headless", "false");

        CefBrowser browser = null;
        try {
            browser = client.createBrowser(url, true, transparent);
            System.out.println("[Loom Browser] createBrowser returned: " + (browser != null ? browser.getClass().getName() : "NULL"));
        } catch (Throwable e) {
            System.err.println("[Loom Browser] createBrowser threw: " + e.getClass().getName() + ": " + e.getMessage());
            e.printStackTrace();
            
            // If direct creation fails, try on AWT EDT
            if (browser == null) {
                try {
                    final CefClient c = client;
                    final String u = url;
                    final boolean t = transparent;
                    final CefBrowser[] result = new CefBrowser[1];
                    javax.swing.SwingUtilities.invokeAndWait(() -> {
                        result[0] = c.createBrowser(u, true, t);
                    });
                    browser = result[0];
                    System.out.println("[Loom Browser] AWT EDT createBrowser returned: " + (browser != null ? browser.getClass().getName() : "NULL"));
                } catch (Exception e2) {
                    System.err.println("[Loom Browser] AWT EDT createBrowser also failed: " + e2.getMessage());
                    e2.printStackTrace();
                }
            }
        } finally {
            // Restore headless mode
            if (wasHeadless != null) {
                System.setProperty("java.awt.headless", wasHeadless);
            } else {
                System.clearProperty("java.awt.headless");
            }
        }
        this.cefBrowser = browser;

        if (this.cefBrowser == null) {
            System.err.println("[Loom Browser] Browser is NULL after all creation attempts!");
            this.paintListener = null;
            return;
        }

        // Register paint listener to capture rendered frames
        this.paintListener = this::onPaintEvent;

        try {
            // The CefClient itself implements CefRenderHandler
            if (client instanceof CefRenderHandler) {
                ((CefRenderHandler) client).addOnPaintListener(this.paintListener);
                System.out.println("[Loom Browser] Paint listener registered on CefClient");
            } else {
                CefRenderHandler renderHandler = cefBrowser.getRenderHandler();
                if (renderHandler != null) {
                    renderHandler.addOnPaintListener(this.paintListener);
                    System.out.println("[Loom Browser] Paint listener registered on browser's render handler");
                } else {
                    System.err.println("[Loom Browser] WARNING: No render handler found");
                }
            }
        } catch (Exception e) {
            System.err.println("[Loom Browser] Failed to register paint listener: " + e.getMessage());
            e.printStackTrace();
        }

        try {
            cefBrowser.createImmediately();
            System.out.println("[Loom Browser] createImmediately() called");
        } catch (Exception e) {
            System.err.println("[Loom Browser] createImmediately failed: " + e.getMessage());
        }

        System.out.println("[Loom Browser] Browser created successfully: " + url);
    }

    // ── Paint event handler (called on CEF thread) ──

    private void onPaintEvent(CefPaintEvent event) {
        if (event.getPopup()) return; // Ignore popup overlays

        ByteBuffer buffer = event.getRenderedFrame();
        int width = event.getWidth();
        int height = event.getHeight();

        if (buffer == null || width <= 0 || height <= 0) return;

        synchronized (bufferLock) {
            int requiredSize = width * height * 4; // BGRA = 4 bytes/pixel
            if (pixelBuffer == null || pixelBuffer.capacity() < requiredSize) {
                pixelBuffer = ByteBuffer.allocateDirect(requiredSize);
            }

            pixelBuffer.clear();
            buffer.rewind();
            pixelBuffer.put(buffer);
            pixelBuffer.flip();

            paintWidth = width;
            paintHeight = height;
            needsUpload.set(true);
        }
    }

    // ── Public API ──

    /**
     * Get the underlying CefBrowser for direct CEF operations.
     */
    public CefBrowser getCefBrowser() {
        return cefBrowser;
    }

    /**
     * Resize the browser viewport.
     * Note: CefBrowser doesn't have a direct resize method in this version.
     * Resizing is handled by returning the correct dimensions from getViewRect
     * via the CefRenderHandler. We store the dimensions and CEF will query them.
     */
    public void resize(int w, int h) {
        if (w <= 0 || h <= 0) return;
        this.viewportWidth = w;
        this.viewportHeight = h;
        // Force CEF to re-query the view rect by invalidating
        // The CefClient's getViewRect will be called on next paint
    }

    /**
     * Get the desired viewport width (used by LoomBrowserEngine's render handler).
     */
    public int getViewportWidth() {
        return viewportWidth;
    }

    /**
     * Get the desired viewport height (used by LoomBrowserEngine's render handler).
     */
    public int getViewportHeight() {
        return viewportHeight;
    }

    /**
     * Navigate to a URL.
     */
    public void loadURL(String url) {
        cefBrowser.loadURL(url);
    }

    /**
     * Get current URL.
     */
    public String getURL() {
        return cefBrowser.getURL();
    }

    /**
     * Execute JavaScript in the browser.
     */
    public void executeJavaScript(String code, String url, int line) {
        cefBrowser.executeJavaScript(code, url, line);
    }

    /**
     * Close the browser and release resources.
     */
    public void close() {
        // Remove paint listener
        try {
            CefRenderHandler renderHandler = cefBrowser.getRenderHandler();
            if (renderHandler != null) {
                renderHandler.removeOnPaintListener(this.paintListener);
            }
        } catch (Exception ignored) {}

        cefBrowser.close(true);

        synchronized (bufferLock) {
            pixelBuffer = null;
        }

        // Note: GL texture deletion should happen on render thread
        // The caller (InGameBrowser) should handle cleanup
        System.out.println("[Loom Browser] Browser closed");
    }

    /**
     * Get the OpenGL texture ID for rendering.
     * Returns 0 if no frame has been rendered yet.
     */
    public int getGlTextureId() {
        return glTextureId;
    }

    /**
     * Upload pending pixel data to the GL texture.
     * MUST be called on the Minecraft render thread each frame.
     */
    public void uploadTexture() {
        if (!needsUpload.get()) return;

        synchronized (bufferLock) {
            if (pixelBuffer == null || paintWidth <= 0 || paintHeight <= 0) return;

            try {
                // Create texture if needed
                if (glTextureId == 0) {
                    glTextureId = org.lwjgl.opengl.GL11.glGenTextures();
                }

                org.lwjgl.opengl.GL11.glBindTexture(
                    org.lwjgl.opengl.GL11.GL_TEXTURE_2D, glTextureId);

                // Texture parameters
                org.lwjgl.opengl.GL11.glTexParameteri(
                    org.lwjgl.opengl.GL11.GL_TEXTURE_2D,
                    org.lwjgl.opengl.GL11.GL_TEXTURE_MIN_FILTER,
                    org.lwjgl.opengl.GL11.GL_LINEAR);
                org.lwjgl.opengl.GL11.glTexParameteri(
                    org.lwjgl.opengl.GL11.GL_TEXTURE_2D,
                    org.lwjgl.opengl.GL11.GL_TEXTURE_MAG_FILTER,
                    org.lwjgl.opengl.GL11.GL_LINEAR);
                org.lwjgl.opengl.GL11.glTexParameteri(
                    org.lwjgl.opengl.GL11.GL_TEXTURE_2D,
                    org.lwjgl.opengl.GL11.GL_TEXTURE_WRAP_S,
                    org.lwjgl.opengl.GL12.GL_CLAMP_TO_EDGE);
                org.lwjgl.opengl.GL11.glTexParameteri(
                    org.lwjgl.opengl.GL11.GL_TEXTURE_2D,
                    org.lwjgl.opengl.GL11.GL_TEXTURE_WRAP_T,
                    org.lwjgl.opengl.GL12.GL_CLAMP_TO_EDGE);

                pixelBuffer.rewind();

                if (paintWidth != textureWidth || paintHeight != textureHeight) {
                    // Full texture upload (new dimensions)
                    org.lwjgl.opengl.GL11.glTexImage2D(
                        org.lwjgl.opengl.GL11.GL_TEXTURE_2D,
                        0,
                        org.lwjgl.opengl.GL11.GL_RGBA8,
                        paintWidth, paintHeight,
                        0,
                        org.lwjgl.opengl.GL12.GL_BGRA,
                        org.lwjgl.opengl.GL11.GL_UNSIGNED_BYTE,
                        pixelBuffer);
                    textureWidth = paintWidth;
                    textureHeight = paintHeight;
                } else {
                    // Sub-image update (same dimensions, faster)
                    org.lwjgl.opengl.GL11.glTexSubImage2D(
                        org.lwjgl.opengl.GL11.GL_TEXTURE_2D,
                        0, 0, 0,
                        paintWidth, paintHeight,
                        org.lwjgl.opengl.GL12.GL_BGRA,
                        org.lwjgl.opengl.GL11.GL_UNSIGNED_BYTE,
                        pixelBuffer);
                }

                org.lwjgl.opengl.GL11.glBindTexture(
                    org.lwjgl.opengl.GL11.GL_TEXTURE_2D, 0);

                needsUpload.set(false);

            } catch (Exception e) {
                System.err.println("[Loom Browser] Texture upload error: " + e.getMessage());
            }
        }
    }

    /**
     * Delete the GL texture. Must be called on the render thread.
     */
    public void deleteTexture() {
        if (glTextureId != 0) {
            org.lwjgl.opengl.GL11.glDeleteTextures(glTextureId);
            glTextureId = 0;
            textureWidth = 0;
            textureHeight = 0;
        }
    }
}
