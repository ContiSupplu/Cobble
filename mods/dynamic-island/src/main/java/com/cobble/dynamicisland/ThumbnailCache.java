package com.cobble.dynamicisland;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.texture.NativeImage;
import net.minecraft.client.texture.NativeImageBackedTexture;
import net.minecraft.util.Identifier;

import java.io.ByteArrayInputStream;
import java.util.Base64;
import java.util.Map;
import java.util.Queue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;

/**
 * Thumbnail cache that receives pre-downloaded base64 image data from Electron.
 * No HTTP downloads happen in Java — Electron handles all network requests.
 *
 * Flow:
 *   1. Electron downloads thumbnail, encodes as base64
 *   2. Base64 sent over WebSocket with search results
 *   3. putBase64() called from LauncherWebSocket (any thread)
 *   4. Background decode: base64 → NativeImage (STB, no OpenGL)
 *   5. Render thread: NativeImage → GPU texture (1 per frame via processPending)
 */
public class ThumbnailCache {

    private static final int MAX_CACHE_SIZE = 40;
    private static final int THUMB_W = 64;
    private static final int THUMB_H = 36; // 16:9

    private static final Map<String, CacheEntry> cache = new ConcurrentHashMap<>();
    private static final Queue<String> uploadQueue = new ConcurrentLinkedQueue<>();
    private static int texCounter = 0;

    private enum State { PENDING, SCALED, READY, FAILED }

    private static class CacheEntry {
        volatile State state = State.PENDING;
        volatile Identifier identifier;
        volatile NativeImage scaledImage;
    }

    /**
     * Store base64 thumbnail data for a URL key.
     * Called from WebSocket thread when search results arrive.
     */
    public static void putBase64(String key, String base64Data) {
        if (key == null || key.isEmpty() || base64Data == null || base64Data.isEmpty()) return;

        if (cache.size() >= MAX_CACHE_SIZE) {
            evictOldest();
        }

        CacheEntry entry = new CacheEntry();
        cache.put(key, entry);

        // Decode on a background thread (STB decode is CPU-only, no OpenGL)
        new Thread(() -> {
            try {
                // Strip data URI prefix if present
                String raw = base64Data;
                int commaIdx = raw.indexOf(',');
                if (commaIdx >= 0) raw = raw.substring(commaIdx + 1);

                byte[] imageBytes = Base64.getDecoder().decode(raw);

                NativeImage original = NativeImage.read(new ByteArrayInputStream(imageBytes));
                int srcW = original.getWidth();
                int srcH = original.getHeight();

                NativeImage scaled = new NativeImage(NativeImage.Format.RGBA, THUMB_W, THUMB_H, false);
                float scaleX = (float) srcW / THUMB_W;
                float scaleY = (float) srcH / THUMB_H;

                for (int dy = 0; dy < THUMB_H; dy++) {
                    for (int dx = 0; dx < THUMB_W; dx++) {
                        int sx = Math.min((int)(dx * scaleX), srcW - 1);
                        int sy = Math.min((int)(dy * scaleY), srcH - 1);
                        scaled.setColor(dx, dy, original.getColor(sx, sy));
                    }
                }
                original.close();

                entry.scaledImage = scaled;
                entry.state = State.SCALED;
                uploadQueue.add(key);
                System.out.println("[Thumbnails] Decoded: " + key.substring(0, Math.min(30, key.length())) + " (" + imageBytes.length + " bytes)");
            } catch (Exception e) {
                entry.state = State.FAILED;
                System.out.println("[Thumbnails] Decode failed for " + key.substring(0, Math.min(30, key.length())) + ": " + e.getMessage());
            }
        }, "ThumbnailDecode").start();
    }

    /**
     * Get the texture Identifier for a thumbnail key.
     * Returns null while loading. Must be called from render thread.
     */
    public static Identifier get(String key) {
        if (key == null || key.isEmpty()) return null;

        // Process pending GPU uploads (up to 4 per frame)
        for (int i = 0; i < 4; i++) {
            processPendingUpload();
        }

        CacheEntry entry = cache.get(key);
        if (entry == null) return null;
        return entry.state == State.READY ? entry.identifier : null;
    }

    /**
     * Render thread: wrap pre-scaled NativeImage in GPU texture.
     */
    private static void processPendingUpload() {
        String key = uploadQueue.poll();
        if (key == null) return;

        CacheEntry entry = cache.get(key);
        if (entry == null || entry.state != State.SCALED || entry.scaledImage == null) return;

        try {
            NativeImageBackedTexture texture = new NativeImageBackedTexture(entry.scaledImage);
            entry.scaledImage = null;

            int id = texCounter++;
            Identifier identifier = Identifier.of("cobble", "thumb_" + id);
            MinecraftClient.getInstance().getTextureManager().registerTexture(identifier, texture);

            entry.identifier = identifier;
            entry.state = State.READY;
        } catch (Exception e) {
            entry.state = State.FAILED;
            if (entry.scaledImage != null) {
                try { entry.scaledImage.close(); } catch (Exception ignored) {}
                entry.scaledImage = null;
            }
        }
    }

    private static void evictOldest() {
        String oldest = cache.keySet().iterator().next();
        evict(oldest);
    }

    private static void evict(String key) {
        CacheEntry entry = cache.remove(key);
        if (entry != null) {
            if (entry.identifier != null) {
                try { MinecraftClient.getInstance().getTextureManager().destroyTexture(entry.identifier); }
                catch (Exception ignored) {}
            }
            if (entry.scaledImage != null) {
                try { entry.scaledImage.close(); } catch (Exception ignored) {}
            }
        }
    }

    public static int getWidth(String url) { return THUMB_W; }
    public static int getHeight(String url) { return THUMB_H; }

    public static void clear() {
        for (String key : cache.keySet()) {
            evict(key);
        }
        uploadQueue.clear();
    }
}
