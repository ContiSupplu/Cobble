package com.cobble.dynamicisland;

import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.font.TextRenderer;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.texture.NativeImage;
import net.minecraft.client.texture.NativeImageBackedTexture;
import net.minecraft.util.Identifier;

import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

/**
 * Dynamic Island — Premium HUD overlay rendered inside Minecraft.
 */
public class DynamicIslandHud implements HudRenderCallback {

    // ── Animation state ────────────────────────────
    private float currentWidth = 100f;
    private float currentHeight = 26f;
    private float currentY = -34f;
    private float shimmerPhase = 0f;
    private float expandProgress = 0f;

    // ── Album art texture ──────────────────────────
    private String currentAlbumUrl = null;
    private Identifier albumTextureId = null;
    private boolean albumLoading = false;
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    // ── Progress interpolation ─────────────────────
    // The WebSocket only sends updates every 2-3s, so we interpolate
    // client-side for smooth progress display.
    private float serverProgress = 0f;   // Last progress from server
    private long serverUpdateTime = 0;   // When we received it
    private long serverDuration = 0;     // Song duration in ms
    private boolean serverPlaying = false;
    private float displayProgress = 0f;  // Smoothed display value

    @Override
    public void onHudRender(DrawContext ctx, float tickDelta) {
        MinecraftClient client = MinecraftClient.getInstance();
        if (client.options.hudHidden || client.player == null) return;

        TextRenderer font = client.textRenderer;
        int screenW = client.getWindow().getScaledWidth();

        LauncherState state = DynamicIslandMod.currentState;
        boolean hasNotif = DynamicIslandMod.hasNotification();
        float notifAlpha = DynamicIslandMod.getNotificationAlpha();
        boolean isExpanded = DynamicIslandMod.isExpanded;

        // ── Animate expand ─────────────────────────
        float expandTarget = (isExpanded && state != null && state.spotify != null && state.spotify.playing) ? 1f : 0f;
        expandProgress += (expandTarget - expandProgress) * 0.12f;
        if (expandProgress < 0.01f) expandProgress = 0f;
        if (expandProgress > 0.99f) expandProgress = 1f;

        // ── Determine target shape & content ───────
        float targetW = 100f;
        float targetH = 26f;
        float targetY = 4f;

        String line1 = "";
        String line2 = "";
        String center = "";
        boolean showMusic = false;
        boolean musicPlaying = false;
        float progress = 0f;

        if (hasNotif) {
            center = DynamicIslandMod.currentNotification;
            targetW = Math.max(150, font.getWidth(center) + 36);
            targetH = 26f;
        } else if (state != null && state.spotify != null && (state.spotify.playing || state.spotify.title != null)) {
            showMusic = true;
            musicPlaying = state.spotify.playing;
            line1 = state.spotify.title != null ? state.spotify.title : "";
            line2 = state.spotify.artist != null ? state.spotify.artist : "";

            // ── Client-side progress interpolation ──
            // Detect new server update
            if (state.spotify.progress != serverProgress || state.spotify.duration != serverDuration) {
                serverProgress = state.spotify.progress;
                serverDuration = state.spotify.duration;
                serverUpdateTime = System.currentTimeMillis();
                serverPlaying = state.spotify.playing;
            }

            // Estimate current progress
            if (serverPlaying && serverDuration > 0) {
                long elapsed = System.currentTimeMillis() - serverUpdateTime;
                progress = serverProgress + (float) elapsed / serverDuration;
                progress = Math.min(1f, progress);
            } else {
                progress = serverProgress;
            }

            // Truncate long titles
            int maxTextW = 140;
            if (font.getWidth(line1) > maxTextW) {
                while (font.getWidth(line1 + "...") > maxTextW && line1.length() > 0) {
                    line1 = line1.substring(0, line1.length() - 1);
                }
                line1 += "...";
            }
            if (font.getWidth(line2) > maxTextW) {
                while (font.getWidth(line2 + "...") > maxTextW && line2.length() > 0) {
                    line2 = line2.substring(0, line2.length() - 1);
                }
                line2 += "...";
            }

            int textW = Math.max(font.getWidth(line1), font.getWidth(line2));
            targetW = Math.max(170, 5 + 22 + 6 + textW + 6 + 18 + 6);
            targetH = 34f;

            if (expandProgress > 0.01f) {
                targetH += 22f * expandProgress;
            }

            if (state.spotify.albumArt != null && !state.spotify.albumArt.equals(currentAlbumUrl)) {
                loadAlbumArt(state.spotify.albumArt);
            }
        } else if (state != null && state.time != null) {
            int px = (int) client.player.getX();
            int py = (int) client.player.getY();
            int pz = (int) client.player.getZ();
            center = state.time + "  §7|§r  " + px + " " + py + " " + pz;
            targetW = Math.max(140, font.getWidth(center) + 32);
            targetH = 26f;
        }

        // ── Smooth animation ───────────────────────
        float lerp = 0.12f;
        currentWidth += (targetW - currentWidth) * lerp;
        currentHeight += (targetH - currentHeight) * lerp;
        currentY += (targetY - currentY) * lerp;
        displayProgress += (progress - displayProgress) * 0.15f;
        shimmerPhase += 0.015f;
        if (shimmerPhase > 2f) shimmerPhase -= 2f;

        int x = (int)(screenW / 2f - currentWidth / 2f);
        int y = (int) currentY;
        int w = (int) currentWidth;
        int h = (int) currentHeight;

        if (w < 10 || h < 10) return;

        // ══════════════════════════════════════════════
        // DRAW PILL BACKGROUND
        // ══════════════════════════════════════════════

        int bgAlpha = hasNotif ? (int)(0xEE * notifAlpha) : 0xEE;
        int bg = (bgAlpha << 24) | 0x0A0A0A;
        int radius = Math.min(h / 2, 16);
        drawRoundedRect(ctx, x, y, w, h, radius, bg);

        if (!hasNotif || notifAlpha > 0.5f) {
            ctx.fill(x + radius, y + 1, x + w - radius, y + 2, 0x0CFFFFFF);
        }

        // Shimmer
        float shimmerX = (shimmerPhase - 0.5f) * w * 2;
        int shimmerLeft = x + Math.max(0, (int) shimmerX);
        int shimmerRight = x + Math.min(w, (int)(shimmerX + w * 0.3f));
        if (shimmerLeft < shimmerRight && shimmerLeft < x + w && shimmerRight > x) {
            shimmerLeft = Math.max(shimmerLeft, x + radius);
            shimmerRight = Math.min(shimmerRight, x + w - radius);
            if (shimmerLeft < shimmerRight) {
                ctx.fill(shimmerLeft, y + 1, shimmerRight, y + h - 1, 0x06FFFFFF);
            }
        }

        // ══════════════════════════════════════════════
        // DRAW CONTENT
        // ══════════════════════════════════════════════

        if (hasNotif) {
            int textAlpha = (int)(0xDD * notifAlpha);
            int textColor = (textAlpha << 24) | 0xDDDDDD;
            int textY = y + (h - 7) / 2;
            int bellX = screenW / 2 - font.getWidth(center) / 2 - 12;
            int bellAlpha = (int)(0xFF * notifAlpha);
            ctx.fill(bellX, textY + 1, bellX + 6, textY + 7, (bellAlpha << 24) | 0xFFAA33);
            ctx.drawTextWithShadow(font, center, screenW / 2 - font.getWidth(center) / 2, textY, textColor);

        } else if (!center.isEmpty()) {
            int textY = y + (h - 7) / 2;
            ctx.drawTextWithShadow(font, center, screenW / 2 - font.getWidth(center) / 2, textY, 0xDDDDDD);

        } else if (showMusic) {
            int compactH = 34;

            int artSize = 22;
            int artX = x + 5;
            int artY = y + (compactH - artSize) / 2;

            // ── Circular album art ─────────────────
            if (albumTextureId != null && !albumLoading) {
                // Draw the square texture first
                ctx.drawTexture(albumTextureId, artX, artY, 0, 0, artSize, artSize, artSize, artSize);
                // Mask corners to make it circular
                drawCircleMask(ctx, artX, artY, artSize, bg);
            } else {
                // Circular placeholder
                drawFilledCircle(ctx, artX, artY, artSize, 0xFF1A1A1A);
                int dotX = artX + artSize / 2 - 2;
                int dotY = artY + artSize / 2 - 2;
                ctx.fill(dotX, dotY, dotX + 5, dotY + 5, 0xFF1DB954);
            }

            // Track info
            int textX = artX + artSize + 6;
            int titleY = y + (compactH / 2) - 9;
            int artistY = y + (compactH / 2) + 1;

            ctx.drawTextWithShadow(font, line1, textX, titleY, 0xFFFFFF);
            ctx.drawTextWithShadow(font, line2, textX, artistY, 0x888888);

            // EQ Visualizer
            if (musicPlaying) {
                long t = System.currentTimeMillis();
                int eqX = x + w - 22;
                int eqY = y + (compactH / 2) - 5;
                int barColor = 0xFF1DB954;
                drawEqBar(ctx, eqX,      eqY, 2, 11, barColor, t, 1.0, 0.0);
                drawEqBar(ctx, eqX + 4,  eqY, 2, 11, barColor, t, 1.3, 0.4);
                drawEqBar(ctx, eqX + 8,  eqY, 2, 11, barColor, t, 0.9, 0.8);
                drawEqBar(ctx, eqX + 12, eqY, 2, 11, barColor, t, 1.1, 1.2);
            } else {
                int pauseX = x + w - 17;
                int pauseY = y + (compactH / 2) - 4;
                ctx.fill(pauseX, pauseY, pauseX + 2, pauseY + 8, 0x55FFFFFF);
                ctx.fill(pauseX + 5, pauseY, pauseX + 7, pauseY + 8, 0x55FFFFFF);
            }

            // Progress bar
            int barY = y + h - 3;
            int barLeft = x + radius;
            int barRight = x + w - radius;
            int barW = barRight - barLeft;
            ctx.fill(barLeft, barY, barRight, barY + 2, 0x33FFFFFF);
            int fillW = (int)(barW * displayProgress);
            if (fillW > 0) {
                ctx.fill(barLeft, barY, barLeft + fillW, barY + 2, 0xCCFFFFFF);
            }

            // Expanded controls
            if (expandProgress > 0.05f) {
                int controlsY = y + compactH + 2;

                // Interpolated time
                long estimatedMs = (long)(displayProgress * serverDuration);
                String timeStr = formatMs(estimatedMs) + " / " + formatMs(serverDuration);
                int timeColor = ((int)(0xAA * expandProgress) << 24) | 0xAAAAAA;
                ctx.drawTextWithShadow(font, timeStr, x + 8, controlsY + 2, timeColor);

                String controls = "M: collapse";
                int ctrlColor = ((int)(0x66 * expandProgress) << 24) | 0x888888;
                ctx.drawTextWithShadow(font, controls, x + w - font.getWidth(controls) - 8, controlsY + 2, ctrlColor);
            }
        }
    }

    // ══════════════════════════════════════════════════
    // DRAWING HELPERS
    // ══════════════════════════════════════════════════

    /**
     * Mask a square region to appear circular by overdrawing corners
     * with the background color. Uses scanline circle math.
     */
    private void drawCircleMask(DrawContext ctx, int x, int y, int size, int bgColor) {
        int r = size / 2;
        int cx = x + r;
        int cy = y + r;

        for (int row = 0; row < size; row++) {
            int dy = r - row;
            int dx = (int) Math.round(Math.sqrt(Math.max(0, (double) r * r - (double) dy * dy)));

            int leftEdge = cx - dx;
            int rightEdge = cx + dx;

            // Overdraw left corner
            if (leftEdge > x) {
                ctx.fill(x, y + row, leftEdge, y + row + 1, bgColor);
            }
            // Overdraw right corner
            if (rightEdge < x + size) {
                ctx.fill(rightEdge, y + row, x + size, y + row + 1, bgColor);
            }
        }
    }

    /**
     * Draw a filled circle (for the placeholder).
     */
    private void drawFilledCircle(DrawContext ctx, int x, int y, int size, int color) {
        int r = size / 2;
        int cx = x + r;
        int cy = y + r;

        for (int row = 0; row < size; row++) {
            int dy = r - row;
            int dx = (int) Math.round(Math.sqrt(Math.max(0, (double) r * r - (double) dy * dy)));
            ctx.fill(cx - dx, y + row, cx + dx, y + row + 1, color);
        }
    }

    private void drawRoundedRect(DrawContext ctx, int x, int y, int w, int h, int r, int color) {
        if (r <= 0) { ctx.fill(x, y, x + w, y + h, color); return; }
        r = Math.min(r, Math.min(w / 2, h / 2));
        ctx.fill(x + r, y, x + w - r, y + h, color);
        ctx.fill(x, y + r, x + r, y + h - r, color);
        ctx.fill(x + w - r, y + r, x + w, y + h - r, color);
        for (int row = 0; row < r; row++) {
            int dy = r - row;
            int dx = (int) Math.round(r - Math.sqrt((double) r * r - (double) dy * dy));
            ctx.fill(x + dx, y + row, x + r, y + row + 1, color);
            ctx.fill(x + w - r, y + row, x + w - dx, y + row + 1, color);
            ctx.fill(x + dx, y + h - 1 - row, x + r, y + h - row, color);
            ctx.fill(x + w - r, y + h - 1 - row, x + w - dx, y + h - row, color);
        }
    }

    private void drawEqBar(DrawContext ctx, int x, int y, int barW, int maxH, int color,
                           long time, double speed, double phase) {
        double t = (time / 80.0) * speed + phase;
        int barH = (int)(4 + (Math.sin(t) * 0.5 + 0.5) * (maxH - 4));
        int barY = y + maxH - barH;
        ctx.fill(x, barY, x + barW, y + maxH, color);
    }

    private String formatMs(long ms) {
        long sec = ms / 1000;
        return (sec / 60) + ":" + String.format("%02d", sec % 60);
    }

    private void loadAlbumArt(String url) {
        if (albumLoading) return;
        albumLoading = true;
        currentAlbumUrl = url;

        new Thread(() -> {
            try {
                HttpRequest req = HttpRequest.newBuilder().uri(URI.create(url)).GET().build();
                HttpResponse<InputStream> resp = HTTP.send(req, HttpResponse.BodyHandlers.ofInputStream());

                if (resp.statusCode() == 200) {
                    java.awt.image.BufferedImage buffered = javax.imageio.ImageIO.read(resp.body());
                    if (buffered == null) { albumLoading = false; return; }

                    int imgW = buffered.getWidth();
                    int imgH = buffered.getHeight();
                    NativeImage image = new NativeImage(imgW, imgH, false);
                    for (int py = 0; py < imgH; py++) {
                        for (int px = 0; px < imgW; px++) {
                            int argb = buffered.getRGB(px, py);
                            int a = (argb >> 24) & 0xFF;
                            int r = (argb >> 16) & 0xFF;
                            int g = (argb >> 8) & 0xFF;
                            int b = argb & 0xFF;
                            image.setColor(px, py, (a << 24) | (b << 16) | (g << 8) | r);
                        }
                    }

                    MinecraftClient.getInstance().execute(() -> {
                        try {
                            if (albumTextureId != null) {
                                MinecraftClient.getInstance().getTextureManager().destroyTexture(albumTextureId);
                            }
                            NativeImageBackedTexture texture = new NativeImageBackedTexture(image);
                            albumTextureId = new Identifier("cobble", "album_art");
                            MinecraftClient.getInstance().getTextureManager().registerTexture(albumTextureId, texture);
                        } catch (Exception e) {
                            System.err.println("[DynamicIsland] Failed to register album art: " + e.getMessage());
                        }
                        albumLoading = false;
                    });
                } else {
                    albumLoading = false;
                }
            } catch (Exception e) {
                System.err.println("[DynamicIsland] Failed to download album art: " + e.getMessage());
                albumLoading = false;
            }
        }, "DI-AlbumArt").start();
    }
}
