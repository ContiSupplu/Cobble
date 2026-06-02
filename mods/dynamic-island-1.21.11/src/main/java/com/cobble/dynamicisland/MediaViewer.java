package com.cobble.dynamicisland;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.texture.NativeImage;
import net.minecraft.client.texture.NativeImageBackedTexture;
import net.minecraft.util.Identifier;

import java.lang.reflect.Method;
import java.net.URI;
import java.nio.IntBuffer;

/**
 * Wraps WATERMeDIA's media player for in-game Twitch stream / YouTube video viewing.
 * Uses PURE REFLECTION to access WATERMeDIA classes so the mod compiles and runs
 * even when WATERMeDIA is not installed.
 *
 * Key WATERMeDIA 2.1.x classes used (all behind runtime checks):
 *   - org.watermedia.api.player.videolan.VideoPlayer
 *   - org.watermedia.api.network.NetworkAPI
 */
public class MediaViewer {
    public enum MediaType { NONE, TWITCH, YOUTUBE }

    public static boolean isOpen = false;
    public static String currentSource = "";
    public static String currentTitle = "";
    public static MediaType mediaType = MediaType.NONE;
    public static boolean watermediaAvailable = false;

    // Volume / mute state
    private static int volume = 50;
    private static boolean muted = false;

    // Player internals (WATERMeDIA) — stored as Object to avoid ClassNotFoundError
    private static Object mediaPlayer = null;
    private static Identifier textureId = null;
    private static RawGlTexture rawTexture = null;
    private static int lastFrameWidth = 0;
    private static int lastFrameHeight = 0;

    // Cached reflection classes/methods
    private static Class<?> videoPlayerClass = null;
    private static Class<?> networkApiClass = null;

    // Search state
    public static String searchQuery = "";
    public static String searchSource = "all"; // "youtube", "twitch", "all"
    public static java.util.List<SearchResult> searchResults = new java.util.ArrayList<>();
    public static boolean isSearching = false;
    public static int searchScroll = 0;
    public static int selectedIndex = -1;

    // Pagination
    public static int searchPage = 0;
    public static final int RESULTS_PER_PAGE = 6;

    // Panels: SEARCH, PLAYING
    public static String activeTab = "SEARCH";

    /**
     * Whether the media player is actively playing (even when panel is hidden).
     * Used by the compact pill to show "now playing" indicator.
     */
    public static boolean isPlayingInBackground() {
        return mediaPlayer != null && mediaType != MediaType.NONE;
    }

    public static class SearchResult {
        public String id;
        public String title;
        public String source;     // "youtube" or "twitch"
        public String thumbnail;
        public String duration;   // "12:34" or "LIVE"
        public String channel;
        public String url;
        public int viewers;
    }

    /**
     * Check whether WATERMeDIA is present at runtime.
     * Called once during mod initialization.
     */
    public static void init() {
        try {
            Class.forName("org.watermedia.api.WaterMediaAPI");
            watermediaAvailable = true;
            // Try to cache the VideoPlayer class
            try {
                videoPlayerClass = Class.forName("org.watermedia.api.player.videolan.VideoPlayer");
            } catch (ClassNotFoundException ignored) {}
            try {
                networkApiClass = Class.forName("org.watermedia.api.network.NetworkAPI");
            } catch (ClassNotFoundException ignored) {}
            System.out.println("[DynamicIsland] WATERMeDIA detected -- media viewer enabled");
        } catch (ClassNotFoundException e) {
            watermediaAvailable = false;
            System.out.println("[DynamicIsland] WATERMeDIA not found -- media viewer disabled (install WATERMeDIA mod for stream/video support)");
        }
    }

    public static void openStream(String url, MediaType type) {
        currentSource = url;
        mediaType = type;
        isOpen = true;
        activeTab = "PLAYING";

        if (!watermediaAvailable || videoPlayerClass == null) {
            System.out.println("[DynamicIsland] Cannot open stream -- WATERMeDIA not installed");
            return;
        }

        // Close any existing player first
        if (mediaPlayer != null) {
            closePlayerInternal();
        }

        try {
            // Create VideoPlayer via reflection
            Object player = videoPlayerClass.getConstructor(Runnable.class)
                .newInstance((Runnable) () -> MinecraftClient.getInstance().execute(() -> {}));

            // Patch URL through WATERMeDIA's network API for compatibility
            URI uri;
            try {
                if (networkApiClass != null) {
                    Method patchMethod = networkApiClass.getMethod("patch", String.class);
                    Object result = patchMethod.invoke(null, url);
                    // Result has a .uri field
                    java.lang.reflect.Field uriField = result.getClass().getField("uri");
                    uri = (URI) uriField.get(result);
                } else {
                    uri = new URI(url);
                }
            } catch (Exception e) {
                uri = new URI(url);
            }

            Method startMethod = videoPlayerClass.getMethod("start", URI.class, String[].class);
            startMethod.invoke(player, uri, new String[]{"--preferred-resolution=1080"});

            Method setVolumeMethod = videoPlayerClass.getMethod("setVolume", int.class);
            setVolumeMethod.invoke(player, muted ? 0 : volume);

            mediaPlayer = player;
            System.out.println("[DynamicIsland] Stream opened: " + url + " [" + type + "]");
        } catch (Exception e) {
            System.out.println("[DynamicIsland] Failed to start stream: " + e.getMessage());
            e.printStackTrace();
            mediaPlayer = null;
        }
    }

    private static void closePlayerInternal() {
        if (mediaPlayer != null) {
            try {
                Method stopMethod = mediaPlayer.getClass().getMethod("stop");
                stopMethod.invoke(mediaPlayer);
                Method releaseMethod = mediaPlayer.getClass().getMethod("release");
                releaseMethod.invoke(mediaPlayer);
            } catch (Exception e) {
                System.out.println("[DynamicIsland] Error closing player: " + e.getMessage());
            }
            mediaPlayer = null;
        }
    }

    /**
     * Hide the media panel without stopping playback.
     * Video/stream continues in background, compact pill shows status.
     */
    public static void hidePanel() {
        isOpen = false;
        // Don't stop the player — it keeps playing
        System.out.println("[DynamicIsland] Media panel hidden (playback continues)");
    }

    /**
     * Fully stop playback and release all resources.
     * Called from explicit "stop" button or when selecting a new video.
     */
    public static void stopStream() {
        if (watermediaAvailable) {
            closePlayerInternal();
        }
        isOpen = false;
        currentSource = "";
        currentTitle = "";
        mediaType = MediaType.NONE;
        activeTab = "SEARCH";

        // Clean up texture wrapper
        if (textureId != null) {
            try {
                MinecraftClient.getInstance().getTextureManager().destroyTexture(textureId);
            } catch (Exception ignored) {}
            textureId = null;
            rawTexture = null;
        }
        lastFrameWidth = 0;
        lastFrameHeight = 0;

        System.out.println("[DynamicIsland] Media stream stopped");
    }

    /**
     * Legacy closeStream — now calls stopStream for backward compat.
     */
    public static void closeStream() {
        stopStream();
    }

    /**
     * Seek to an absolute position in milliseconds.
     * Used by the clickable progress bar.
     */
    public static void seekTo(long positionMs) {
        if (!watermediaAvailable || mediaPlayer == null) return;
        try {
            Method seekToMethod = mediaPlayer.getClass().getMethod("seekTo", long.class);
            seekToMethod.invoke(mediaPlayer, positionMs);
        } catch (Exception e) {
            System.out.println("[DynamicIsland] Seek failed: " + e.getMessage());
        }
    }

    public static void togglePause() {
        if (!watermediaAvailable || mediaPlayer == null) return;
        try {
            Method isPlayingMethod = mediaPlayer.getClass().getMethod("isPlaying");
            boolean playing = (boolean) isPlayingMethod.invoke(mediaPlayer);
            if (playing) {
                Method pauseMethod = mediaPlayer.getClass().getMethod("pause");
                pauseMethod.invoke(mediaPlayer);
            } else {
                Method playMethod = mediaPlayer.getClass().getMethod("play");
                playMethod.invoke(mediaPlayer);
            }
        } catch (Exception e) {
            System.out.println("[DynamicIsland] Toggle pause error: " + e.getMessage());
        }
    }

    public static void seek(long deltaMs) {
        if (!watermediaAvailable || mediaPlayer == null) return;
        try {
            Method getTimeMethod = mediaPlayer.getClass().getMethod("getTime");
            long pos = (long) getTimeMethod.invoke(mediaPlayer);
            long target = Math.max(0, pos + deltaMs);
            Method seekToMethod = mediaPlayer.getClass().getMethod("seekTo", long.class);
            seekToMethod.invoke(mediaPlayer, target);
        } catch (Exception e) {
            System.out.println("[DynamicIsland] Seek error: " + e.getMessage());
        }
    }

    public static void setVolume(int vol) {
        volume = Math.max(0, Math.min(100, vol));
        if (!watermediaAvailable || mediaPlayer == null) return;
        if (!muted) {
            try {
                Method setVolumeMethod = mediaPlayer.getClass().getMethod("setVolume", int.class);
                setVolumeMethod.invoke(mediaPlayer, volume);
            } catch (Exception ignored) {}
        }
    }

    public static void toggleMute() {
        muted = !muted;
        if (!watermediaAvailable || mediaPlayer == null) return;
        try {
            Method setVolumeMethod = mediaPlayer.getClass().getMethod("setVolume", int.class);
            setVolumeMethod.invoke(mediaPlayer, muted ? 0 : volume);
        } catch (Exception ignored) {}
    }

    public static long getPosition() {
        if (!watermediaAvailable || mediaPlayer == null) return 0;
        try {
            Method getTimeMethod = mediaPlayer.getClass().getMethod("getTime");
            return (long) getTimeMethod.invoke(mediaPlayer);
        } catch (Exception e) { return 0; }
    }

    public static long getDuration() {
        if (!watermediaAvailable || mediaPlayer == null) return 0;
        try {
            Method getDurationMethod = mediaPlayer.getClass().getMethod("getDuration");
            return (long) getDurationMethod.invoke(mediaPlayer);
        } catch (Exception e) { return 0; }
    }

    public static boolean isPlaying() {
        if (!watermediaAvailable || mediaPlayer == null) return false;
        try {
            Method isPlayingMethod = mediaPlayer.getClass().getMethod("isPlaying");
            return (boolean) isPlayingMethod.invoke(mediaPlayer);
        } catch (Exception e) { return false; }
    }

    public static boolean isMuted() { return muted; }

    public static int getVolume() { return volume; }

    public static Identifier getTextureIdentifier() { return textureId; }

    /**
     * Called each render frame to upload the latest video frame to a GPU texture.
     * Must be called on the render thread.
     */
    @SuppressWarnings("deprecation")
    public static void preRender() {
        if (!watermediaAvailable || mediaPlayer == null) return;

        try {
            // Call preRender to update the internal frame buffer
            Method preRenderMethod = mediaPlayer.getClass().getMethod("preRender");
            preRenderMethod.invoke(mediaPlayer);

            // Get the raw GL texture handle from WATERMeDIA
            Method textureMethod = mediaPlayer.getClass().getMethod("texture");
            int texId = (int) textureMethod.invoke(mediaPlayer);
            if (texId <= 0) return;

            // Create and register our RawGlTexture wrapper once
            if (rawTexture == null) {
                rawTexture = new RawGlTexture();
                textureId = Identifier.of("cobble", "media_frame");
                MinecraftClient.getInstance().getTextureManager().registerTexture(textureId, rawTexture);
            }

            // Update the GL ID each frame (WATERMeDIA may change it)
            rawTexture.setGlId(texId);

            // Try to get video dimensions
            try {
                Method widthMethod = mediaPlayer.getClass().getMethod("width");
                Method heightMethod = mediaPlayer.getClass().getMethod("height");
                int w = (int) widthMethod.invoke(mediaPlayer);
                int h = (int) heightMethod.invoke(mediaPlayer);
                if (w > 0 && h > 0) {
                    rawTexture.setDimensions(w, h);
                    lastFrameWidth = w;
                    lastFrameHeight = h;
                }
            } catch (Exception ignored) {}
        } catch (Exception e) {
            // Silently fail on render thread
        }
    }

    /**
     * Check if the video texture is ready for rendering.
     */
    public static boolean hasTexture() {
        return rawTexture != null && rawTexture.getGlId() > 0;
    }

    // ── Search Methods ──

    public static void sendSearch(String query, String source) {
        searchQuery = query;
        searchSource = source;
        isSearching = true;
        searchResults.clear();
        searchScroll = 0;
        selectedIndex = -1;
        searchPage = 0;

        // Send search request to launcher via WebSocket
        if (LauncherWebSocket.getInstance() != null && LauncherWebSocket.getInstance().isOpen()) {
            String json = String.format(
                "{\"type\":\"media_search\",\"query\":\"%s\",\"source\":\"%s\"}",
                query.replace("\"", "\\\""),
                source
            );
            LauncherWebSocket.getInstance().send(json);
        }
    }

    public static void receiveSearchResults(java.util.List<SearchResult> results) {
        searchResults = results;
        isSearching = false;
        searchScroll = 0;
        searchPage = 0;
        selectedIndex = results.isEmpty() ? -1 : 0;
    }

    // ── Pagination ──

    public static int getTotalPages() {
        return Math.max(1, (int) Math.ceil((double) searchResults.size() / RESULTS_PER_PAGE));
    }

    public static java.util.List<SearchResult> getPageResults() {
        int start = searchPage * RESULTS_PER_PAGE;
        int end = Math.min(start + RESULTS_PER_PAGE, searchResults.size());
        if (start >= searchResults.size()) return java.util.Collections.emptyList();
        return searchResults.subList(start, end);
    }

    public static void nextPage() {
        if (searchPage < getTotalPages() - 1) {
            searchPage++;
            selectedIndex = -1;
        }
    }

    public static void prevPage() {
        if (searchPage > 0) {
            searchPage--;
            selectedIndex = -1;
        }
    }

    /** Get the absolute index of a result from a page-relative index. */
    public static int absoluteIndex(int pageRelativeIndex) {
        return searchPage * RESULTS_PER_PAGE + pageRelativeIndex;
    }

    public static void selectResult(int index) {
        if (index < 0 || index >= searchResults.size()) return;
        SearchResult result = searchResults.get(index);
        selectedIndex = index;

        // Send selection to launcher for URL resolution and playback
        if (LauncherWebSocket.getInstance() != null && LauncherWebSocket.getInstance().isOpen()) {
            String json = String.format(
                "{\"type\":\"media_select\",\"result\":{\"id\":\"%s\",\"url\":\"%s\",\"source\":\"%s\",\"title\":\"%s\",\"channel\":\"%s\"}}",
                result.id.replace("\"", "\\\""),
                result.url.replace("\"", "\\\""),
                result.source,
                result.title.replace("\"", "\\\""),
                result.channel != null ? result.channel.replace("\"", "\\\"") : ""
            );
            LauncherWebSocket.getInstance().send(json);
        }

        currentTitle = result.title;
    }

    /**
     * Release all resources. Called on mod shutdown / world disconnect.
     */
    public static void cleanup() {
        closeStream();
        searchResults.clear();
        searchQuery = "";
        isSearching = false;
    }
}
