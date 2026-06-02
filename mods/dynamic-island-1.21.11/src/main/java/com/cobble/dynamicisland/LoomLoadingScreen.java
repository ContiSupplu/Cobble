package com.cobble.dynamicisland;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.font.TextRenderer;
import net.minecraft.client.gui.DrawContext;

/**
 * Loom-branded loading screen renderer.
 *
 * Draws a custom splash overlay with:
 *   - Dark gradient background (#0c0c1a)
 *   - "LOOM" text logo centered with subtle glow
 *   - Animated progress bar with glow effect
 *   - Phase text describing current loading stage
 *   - Rotating tip messages at the bottom
 *   - Smooth fade-in / fade-out transitions
 *
 * Called from SplashOverlayMixin which cancels vanilla rendering.
 */
public class LoomLoadingScreen {

    // ── Timing ──
    private static long firstRenderTime = -1;
    private static long fadeOutStartTime = -1;

    // ── Animation state ──
    private static float smoothProgress = 0f;
    private static float shimmerPhase = 0f;
    private static int lastTipIndex = 0;
    private static long lastTipSwitch = 0;
    private static final long TIP_ROTATE_MS = 4000;

    // ── Fade durations ──
    private static final long FADE_IN_MS = 600;
    private static final long FADE_OUT_MS = 800;

    // ── Colors ──
    private static final int BG_TOP = 0xFF0C0C1A;
    private static final int BG_BOTTOM = 0xFF12122A;
    private static final int ACCENT = 0xFF6C5CE7;       // Loom purple
    private static final int ACCENT_GLOW = 0xFF8B7CF7;
    private static final int BAR_BG = 0xFF1E1E3A;
    private static final int TEXT_DIM = 0xFF666688;
    private static final int TEXT_TIP = 0xFF555577;

    // ── Phase names ──
    private static final String[] PHASES = {
        "Loading mods...",
        "Processing resources...",
        "Building textures...",
        "Baking models...",
        "Almost ready..."
    };

    // ── Tips ──
    private static final String[] TIPS = {
        "Tip: Press F3 for debug info",
        "Loom optimizes your game automatically",
        "Tip: Use F1 to hide the HUD",
        "Dynamic Island shows alerts in real-time",
        "Tip: Press Tab to see the player list",
        "Loom keeps your sessions safe and fast",
        "Tip: F5 toggles third-person view",
        "Your mods are being loaded by Fabric"
    };

    /**
     * Reset state — called when a new splash overlay begins.
     */
    public static void reset() {
        firstRenderTime = -1;
        fadeOutStartTime = -1;
        smoothProgress = 0f;
        shimmerPhase = 0f;
        lastTipIndex = 0;
        lastTipSwitch = 0;
    }

    /**
     * Renders the full Loom loading screen.
     *
     * @param ctx          the draw context
     * @param rawProgress  reload progress from 0.0 to 1.0
     * @param reloadDone   true once the reload has finished
     * @return true if the screen has fully faded out (caller should remove the overlay)
     */
    public static boolean render(DrawContext ctx, float rawProgress, boolean reloadDone) {
        MinecraftClient client = MinecraftClient.getInstance();
        TextRenderer font = client.textRenderer;
        int screenW = client.getWindow().getScaledWidth();
        int screenH = client.getWindow().getScaledHeight();
        long now = System.currentTimeMillis();

        // ── First-render timestamp ──
        if (firstRenderTime < 0) {
            firstRenderTime = now;
            lastTipSwitch = now;
        }

        // ── Fade-out tracking ──
        if (reloadDone && fadeOutStartTime < 0) {
            fadeOutStartTime = now;
        }

        // ── Compute overall alpha ──
        float alpha;
        if (fadeOutStartTime > 0) {
            float fadeOut = 1f - Math.min(1f, (now - fadeOutStartTime) / (float) FADE_OUT_MS);
            if (fadeOut <= 0f) return true; // fully faded — signal removal
            alpha = fadeOut;
        } else {
            alpha = Math.min(1f, (now - firstRenderTime) / (float) FADE_IN_MS);
        }
        int a = (int) (alpha * 255f);

        // ── Background gradient ──
        // Top half
        ctx.fill(0, 0, screenW, screenH / 2, withAlpha(BG_TOP, a));
        // Bottom half — slightly lighter
        ctx.fill(0, screenH / 2, screenW, screenH, withAlpha(BG_BOTTOM, a));
        // Subtle vignette at top and bottom edges
        ctx.fill(0, 0, screenW, 2, withAlpha(0xFF000000, (int)(a * 0.4f)));
        ctx.fill(0, screenH - 2, screenW, screenH, withAlpha(0xFF000000, (int)(a * 0.4f)));

        // ── Smooth progress ──
        smoothProgress += (rawProgress - smoothProgress) * 0.08f;
        if (smoothProgress > 0.995f) smoothProgress = 1f;

        // ── Center Y anchor ──
        int centerY = screenH / 2 - 20;

        // ── "LOOM" logo text ──
        String logo = "LOOM";
        // Draw at 1x scale but make it prominent with glow effect
        int logoW = font.getWidth(logo);

        // Glow layers (drawn behind text for a bloom effect)
        int glowAlpha = (int)(a * 0.15f);
        for (int dx = -1; dx <= 1; dx++) {
            for (int dy = -1; dy <= 1; dy++) {
                if (dx == 0 && dy == 0) continue;
                ctx.drawTextWithShadow(font, logo,
                    screenW / 2 - logoW / 2 + dx,
                    centerY - 16 + dy,
                    withAlpha(ACCENT_GLOW, glowAlpha));
            }
        }
        // Main logo text
        ctx.drawTextWithShadow(font, logo,
            screenW / 2 - logoW / 2,
            centerY - 16,
            withAlpha(ACCENT, a));

        // Subtitle
        String subtitle = "L A U N C H E R";
        int subW = font.getWidth(subtitle);
        ctx.drawTextWithShadow(font, subtitle,
            screenW / 2 - subW / 2,
            centerY - 4,
            withAlpha(TEXT_DIM, (int)(a * 0.7f)));

        // ── Progress bar ──
        int barW = Math.min(200, screenW - 40);
        int barH = 4;
        int barX = screenW / 2 - barW / 2;
        int barY = centerY + 16;

        // Bar background
        ctx.fill(barX, barY, barX + barW, barY + barH, withAlpha(BAR_BG, a));

        // Filled portion
        int filledW = (int)(barW * smoothProgress);
        if (filledW > 0) {
            ctx.fill(barX, barY, barX + filledW, barY + barH, withAlpha(ACCENT, a));

            // Shimmer on the filled bar
            shimmerPhase += 0.02f;
            if (shimmerPhase > 2f) shimmerPhase -= 2f;
            float shimX = (shimmerPhase - 0.5f) * filledW * 2;
            int sL = barX + Math.max(0, (int) shimX);
            int sR = barX + Math.min(filledW, (int)(shimX + filledW * 0.3f));
            if (sL < sR && sL < barX + filledW && sR > barX) {
                ctx.fill(sL, barY, sR, barY + barH, withAlpha(ACCENT_GLOW, (int)(a * 0.4f)));
            }

            // Glow dot at the leading edge
            int dotX = barX + filledW;
            float pulse = 0.6f + 0.4f * (float) Math.sin(now * 0.006);
            int dotAlpha = (int)(a * 0.5f * pulse);
            ctx.fill(dotX - 1, barY - 1, dotX + 2, barY + barH + 1, withAlpha(ACCENT_GLOW, dotAlpha));
        }

        // ── Percentage text ──
        String pctText = (int)(smoothProgress * 100) + "%";
        int pctW = font.getWidth(pctText);
        ctx.drawTextWithShadow(font, pctText,
            screenW / 2 - pctW / 2,
            barY + barH + 6,
            withAlpha(ACCENT, (int)(a * 0.8f)));

        // ── Phase text ──
        int phaseIdx;
        if (smoothProgress < 0.20f)      phaseIdx = 0;
        else if (smoothProgress < 0.40f) phaseIdx = 1;
        else if (smoothProgress < 0.60f) phaseIdx = 2;
        else if (smoothProgress < 0.80f) phaseIdx = 3;
        else                             phaseIdx = 4;
        String phase = PHASES[phaseIdx];
        int phaseW = font.getWidth(phase);
        ctx.drawTextWithShadow(font, phase,
            screenW / 2 - phaseW / 2,
            barY + barH + 18,
            withAlpha(TEXT_DIM, (int)(a * 0.9f)));

        // ── Rotating tips at bottom ──
        if (now - lastTipSwitch > TIP_ROTATE_MS) {
            lastTipSwitch = now;
            lastTipIndex = (lastTipIndex + 1) % TIPS.length;
        }
        // Fade transition for tips
        long tipAge = now - lastTipSwitch;
        float tipAlpha;
        if (tipAge < 400) {
            tipAlpha = tipAge / 400f; // fade in
        } else if (tipAge > TIP_ROTATE_MS - 400) {
            tipAlpha = (TIP_ROTATE_MS - tipAge) / 400f; // fade out
        } else {
            tipAlpha = 1f;
        }
        tipAlpha = Math.max(0f, Math.min(1f, tipAlpha));

        String tip = TIPS[lastTipIndex];
        int tipW = font.getWidth(tip);
        ctx.drawTextWithShadow(font, tip,
            screenW / 2 - tipW / 2,
            screenH - 24,
            withAlpha(TEXT_TIP, (int)(a * tipAlpha * 0.8f)));

        // ── Decorative particles / dots ──
        drawDecoParticles(ctx, screenW, screenH, now, a);

        return false; // still rendering
    }

    /**
     * Draws subtle floating particles in the background for visual polish.
     */
    private static void drawDecoParticles(DrawContext ctx, int screenW, int screenH, long now, int alpha) {
        int particleCount = 6;
        for (int i = 0; i < particleCount; i++) {
            // Deterministic but animated positions using sin/cos
            double phase = i * 1.7 + now * 0.0004;
            int px = (int)(screenW * 0.2 + screenW * 0.6 * (0.5 + 0.5 * Math.sin(phase)));
            int py = (int)(screenH * 0.15 + screenH * 0.7 * (0.5 + 0.5 * Math.cos(phase * 0.7 + i)));
            float pAlpha = (float)(0.15 + 0.1 * Math.sin(phase * 2.3));
            int pa = (int)(alpha * pAlpha);
            int size = 1 + (i % 2);
            ctx.fill(px, py, px + size, py + size, withAlpha(ACCENT_GLOW, pa));
        }
    }

    /**
     * Helper: set alpha on an ARGB color.
     */
    private static int withAlpha(int argb, int alpha) {
        alpha = Math.max(0, Math.min(255, alpha));
        return (alpha << 24) | (argb & 0x00FFFFFF);
    }
}
