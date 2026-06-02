package com.cobble.dynamicisland;

import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.font.TextRenderer;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.render.RenderTickCounter;
import net.minecraft.client.render.Tessellator;
import net.minecraft.client.render.VertexFormat;
import net.minecraft.client.render.VertexFormats;
import net.minecraft.client.render.BufferRenderer;
import net.minecraft.client.texture.NativeImage;
import net.minecraft.client.texture.NativeImageBackedTexture;
import net.minecraft.client.texture.AbstractTexture;
import net.minecraft.resource.ResourceManager;
import net.minecraft.util.Identifier;
import net.minecraft.item.ItemStack;
import com.mojang.blaze3d.systems.RenderSystem;
import org.lwjgl.opengl.GL11;

import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class DynamicIslandHud implements HudRenderCallback {

    private float currentWidth = 100f;
    private float currentHeight = 26f;
    private float currentY = -34f;
    private float shimmerPhase = 0f;
    private float expandProgress = 0f;
    private float pebbleProgress = 0f;
    private float notifCenterProgress = 0f;
    private float settingsProgress = 0f;
    private float combatProgress = 0f;
    private float mediaProgress = 0f;

    // Browser texture wrapper for MCEF rendering
    private static final Identifier BROWSER_TEX_ID = Identifier.of("cobble", "mcef_browser");
    private static int lastBrowserTexId = 0;
    private static int browserGlTexId = 0;
    private static final AbstractTexture BROWSER_TEXTURE = new AbstractTexture() {
        @Override public void load(ResourceManager mgr) {}
        @Override public int getGlId() { return browserGlTexId; }
        @Override public void close() {} // Don't delete MCEF's texture
    };
    private long browserFrameCount = 0; // Frame counter for skipping

    // App Drawer state
    public static boolean isAppDrawerOpen = false;
    public static float appDrawerProgress = 0f;
    public static int mouseX = 0, mouseY = 0;

    // Coord copy/share feedback
    private String coordFeedback = null;
    private long coordFeedbackUntil = 0;

    private String currentAlbumUrl = null;
    private Identifier albumTextureId = null;
    private boolean albumLoading = false;
    private int albumTintColor = 0x0A0A0A;
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    private float serverProgress = 0f;
    private long serverUpdateTime = 0;
    private long serverDuration = 0;
    private boolean serverPlaying = false;
    private float displayProgress = 0f;
    private float lyricsScrollOffset = 0f;
    private int lastLyricsIndex = -1;

    @Override
    public void onHudRender(DrawContext ctx, RenderTickCounter tickCounter) {
        MinecraftClient client = MinecraftClient.getInstance();
        if (client.options.hudHidden || client.player == null) return;

        TextRenderer font = client.textRenderer;
        int screenW = client.getWindow().getScaledWidth();

        LauncherState state = DynamicIslandMod.currentState;
        boolean hasNotif = DynamicIslandMod.hasNotification();
        float notifAlpha = DynamicIslandMod.getNotificationAlpha();
        boolean isExpanded = DynamicIslandMod.isExpanded;

        float expandTarget = (isExpanded && state != null && state.spotify != null && state.spotify.playing) ? 1f : 0f;
        expandProgress += (expandTarget - expandProgress) * 0.12f;
        if (expandProgress < 0.01f) expandProgress = 0f;
        if (expandProgress > 0.99f) expandProgress = 1f;

        // ── Determine content ──────────────────────
        float targetW = 100f;
        float targetH = 26f;
        float targetY = 4f;

        String line1 = "";
        String line2 = "";
        String center = "";
        boolean showMusic = false;
        boolean musicPlaying = false;
        boolean showDeath = false;
        boolean showBiome = GameAlerts.hasBiomeSubtitle();
        boolean showCombat = false;
        boolean showWaypoint = false;
        float progress = 0f;
        boolean isAlert = false;

        boolean hasMusic = state != null && state.spotify != null && (state.spotify.playing || state.spotify.title != null);
        boolean deathWantsDeath = GameAlerts.persistentText != null && "death".equals(GameAlerts.persistentType);
        boolean songPeek = GameAlerts.isSongPeekActive() && hasMusic;
        boolean nonDeathPersistent = GameAlerts.persistentText != null && !"death".equals(GameAlerts.persistentType);
        boolean combatActive = CombatTracker.isInCombat();
        boolean waypointActive = WaypointManager.activeWaypoint != null;

        // Combat-relevant alert types (shine through combat HUD)
        boolean isCombatRelevantAlert = nonDeathPersistent && (
            "elytra".equals(GameAlerts.persistentType) ||
            "effect".equals(GameAlerts.persistentType) ||
            "durability".equals(GameAlerts.persistentType)
        );

        // Clear displayed coords
        DynamicIslandMod.displayedCoords = null;

        // Priority: combat-relevant alerts > combat HUD > notification > waypoint > persistent > death > music > idle
        if (combatActive && isCombatRelevantAlert) {
            // Combat-relevant alerts shine through
            center = GameAlerts.persistentText;
            isAlert = GameAlerts.persistentIsAlert;
            targetW = Math.max(160, font.getWidth(center) + 28);
            targetH = 26f;
        } else if (combatActive) {
            // Combat HUD
            showCombat = true;
            // Auto-close media panel when entering combat (audio keeps playing)
            if (DynamicIslandMod.isMediaOpen) {
                DynamicIslandMod.isMediaOpen = false;
                if (MinecraftClient.getInstance().currentScreen instanceof TwitchScreen) {
                    MinecraftClient.getInstance().setScreen(null);
                }
            }
            if (CombatTracker.isCelebrating()) {
                String killText = "✦ Eliminated " + CombatTracker.killedPlayerName;
                targetW = Math.max(160, font.getWidth(killText) + 32);
                targetH = 30f;
            } else {
                String oppName = CombatTracker.opponentName != null ? CombatTracker.opponentName : "Unknown";
                int nameW = font.getWidth(oppName);
                String hpStr = (int)CombatTracker.opponentHealth + "/" + (int)CombatTracker.opponentMaxHealth;
                int hpW = font.getWidth(hpStr);
                // Width = head(22) + max(name+hp, hearts, equipment) + padding
                int heartsW = Math.max(1, (int)(CombatTracker.opponentMaxHealth / 2)) * font.getWidth("\u2764");
                int equipW = 4 * 14 + 6 + 2 * 14; // 4 armor + divider + weapon/offhand
                int contentW = Math.max(nameW + hpW + 12, Math.max(heartsW, equipW));
                targetW = 22 + contentW + 12;
                targetH = !CombatTracker.opponentEffects.isEmpty() ? 68f : 56f;
            }
        } else if (hasNotif) {
            center = DynamicIslandMod.currentNotification;
            targetW = Math.max(150, font.getWidth(center) + 28);
            targetH = 26f;
            isAlert = center.contains("Health") || center.contains("Hunger");
        } else if (waypointActive) {
            showWaypoint = true;
            WaypointManager.Waypoint wp = WaypointManager.activeWaypoint;
            int px = (int) client.player.getX();
            int pz = (int) client.player.getZ();
            float yaw = client.player.getYaw();
            int dist = (int) WaypointManager.getDistance(px, pz);
            String dir = WaypointManager.getRelativeDirection(px, pz, yaw);
            center = dist + " blocks · " + dir;
            String wpCoords = wp.x + " " + wp.y + " " + wp.z;
            targetW = Math.max(180, Math.max(font.getWidth(center), font.getWidth(wpCoords)) + 32);
            targetH = 40f;
            DynamicIslandMod.displayedCoords = wpCoords;
        } else if (TimerManager.hasFinishedTimer()) {
            // Timer just finished — persistent until dismissed
            center = "⏱ " + TimerManager.finishedTimerName + " finished!";
            targetW = Math.max(180, font.getWidth(center) + 32);
            targetH = 40f;
        } else if (TimerManager.isInCountdown()) {
            // Last 10 seconds of a timer — live countdown
            long remaining = TimerManager.getRemaining(TimerManager.countdownTimer);
            center = "⏱ " + TimerManager.countdownTimer.name;
            targetW = Math.max(150, font.getWidth(center) + 32);
            targetH = 34f;
        } else if (nonDeathPersistent) {
            center = GameAlerts.persistentText;
            isAlert = GameAlerts.persistentIsAlert;
            targetW = Math.max(160, font.getWidth(center) + 28);
            targetH = 26f;
        } else if (deathWantsDeath && !songPeek) {
            showDeath = true;
            center = GameAlerts.persistentText;
            String coords = GameAlerts.getDeathCoords();
            targetW = Math.max(180, Math.max(font.getWidth(center), font.getWidth(coords)) + 32);
            targetH = 40f;
            DynamicIslandMod.displayedCoords = coords;
        } else if (hasMusic) {
            showMusic = true;
            musicPlaying = state.spotify.playing;
            line1 = state.spotify.title != null ? state.spotify.title : "";
            line2 = state.spotify.artist != null ? state.spotify.artist : "";

            if (state.spotify.progress != serverProgress || state.spotify.duration != serverDuration) {
                serverProgress = state.spotify.progress;
                serverDuration = state.spotify.duration;
                serverUpdateTime = System.currentTimeMillis();
                serverPlaying = state.spotify.playing;
            }

            if (serverPlaying && serverDuration > 0) {
                long elapsed = System.currentTimeMillis() - serverUpdateTime;
                progress = serverProgress + (float) elapsed / serverDuration;
                progress = Math.min(1f, progress);
            } else {
                progress = serverProgress;
            }

            int maxTextW = 140;
            if (font.getWidth(line1) > maxTextW) {
                while (font.getWidth(line1 + "...") > maxTextW && line1.length() > 0)
                    line1 = line1.substring(0, line1.length() - 1);
                line1 += "...";
            }
            if (font.getWidth(line2) > maxTextW) {
                while (font.getWidth(line2 + "...") > maxTextW && line2.length() > 0)
                    line2 = line2.substring(0, line2.length() - 1);
                line2 += "...";
            }

            int textW = Math.max(font.getWidth(line1), font.getWidth(line2));
            targetW = Math.max(170, 5 + 22 + 6 + textW + 6 + 18 + 6);
            targetH = 34f;

            if (expandProgress > 0.01f) targetH += 22f * expandProgress;

            // Lyrics mode: expand for 3 lines of lyrics
            boolean hasLyrics = DynamicIslandMod.isLyricsMode && state.spotify.lyrics != null && state.spotify.lyrics.length > 0;
            if (hasLyrics) {
                targetH = 120f;
                targetW = Math.max(targetW, 240f);
            }

            if (state.spotify.albumArt != null && !state.spotify.albumArt.equals(currentAlbumUrl)) {
                loadAlbumArt(state.spotify.albumArt);
            }
        } else if (state != null && state.time != null) {
            int px = (int) client.player.getX();
            int py = (int) client.player.getY();
            int pz = (int) client.player.getZ();
            String mcTime = GameAlerts.getMcTimeDisplay();
            if (mcTime != null) {
                center = state.time + "  §7|§r  " + mcTime + "  §7|§r  " + px + " " + py + " " + pz;
            } else {
                center = state.time + "  §7|§r  " + px + " " + py + " " + pz;
            }
            targetW = Math.max(140, font.getWidth(center) + 32);
            targetH = 26f;
            DynamicIslandMod.displayedCoords = px + " " + py + " " + pz;
        }

        // Coord feedback display
        if (coordFeedback != null && System.currentTimeMillis() > coordFeedbackUntil) {
            coordFeedback = null;
        }

        // Biome footnote expands pill slightly
        if (showBiome && !hasNotif && !showCombat && !DynamicIslandMod.isPebbleOpen && !DynamicIslandMod.isNotifCenterOpen && !DynamicIslandMod.isSettingsOpen && !DynamicIslandMod.isMediaOpen) targetH += 12f;

        // Panel overrides — unique sizes per panel
        boolean pebbleOpen = DynamicIslandMod.isPebbleOpen;
        boolean notifOpen = DynamicIslandMod.isNotifCenterOpen;
        boolean settingsOpen = DynamicIslandMod.isSettingsOpen;
        boolean mediaOpen = DynamicIslandMod.isMediaOpen;
        boolean drawerOpen = isAppDrawerOpen;
        if (pebbleOpen) { targetW = 280f; targetH = 200f; }
        if (notifOpen) { targetW = 260f; targetH = 220f; }
        if (settingsOpen) { targetW = 300f; targetH = 260f; }
        if (mediaOpen) {
            if (InGameBrowser.isActive) {
                // Browser mode — large panel for desktop YouTube/Twitch
                int scaledH = client.getWindow().getScaledHeight();
                targetW = Math.min(screenW - 6, 560f);
                targetH = Math.min(scaledH * 0.82f, scaledH - 50f);
            } else {
                boolean isPlaying = !"SEARCH".equals(MediaViewer.activeTab);
                if (isPlaying) { targetW = 360f; targetH = 260f; }
                else {
                    int resultCount = MediaViewer.searchResults.isEmpty() ? 0 : MediaViewer.getPageResults().size();
                    if (resultCount == 0 && !MediaViewer.isSearching) {
                        targetW = 300f; targetH = 50f;
                    } else if (resultCount == 0 && MediaViewer.isSearching) {
                        targetW = 300f; targetH = 70f;
                    } else {
                        targetW = 350f;
                        targetH = Math.min(40 + resultCount * 36 + 30, 300f);
                    }
                }
            }
        }
        if (drawerOpen) { targetW = 220f; targetH = 180f; } // 3x2 grid
        // Background media playback — wider pill to show title + EQ bars
        if (!mediaOpen && !pebbleOpen && !notifOpen && !settingsOpen && !drawerOpen && !showCombat) {
            if (MediaViewer.isPlayingInBackground()) {
                String bgTitle = MediaViewer.currentTitle;
                int titleW = font.getWidth(bgTitle);
                targetW = Math.max(220, Math.min(titleW + 60, 320));
                targetH = 34f;
            } else if (InGameBrowser.isPlayingInBackground()) {
                String bgTitle = InGameBrowser.pageTitle;
                if (bgTitle.isEmpty()) bgTitle = "Browser";
                int titleW = font.getWidth(bgTitle);
                targetW = Math.max(220, Math.min(titleW + 60, 320));
                targetH = 34f;
            }
        }

        // ── Animation ──────────────────────────────
        float lerp = 0.12f;
        currentWidth += (targetW - currentWidth) * lerp;
        currentHeight += (targetH - currentHeight) * lerp;
        currentY += (targetY - currentY) * lerp;
        displayProgress += (progress - displayProgress) * 0.15f;
        shimmerPhase += 0.015f;
        if (shimmerPhase > 2f) shimmerPhase -= 2f;

        // Panel open/close progress
        float pebbleTarget = pebbleOpen ? 1f : 0f;
        pebbleProgress += (pebbleTarget - pebbleProgress) * 0.1f;
        if (pebbleProgress < 0.005f) pebbleProgress = 0f;
        if (pebbleProgress > 0.995f) pebbleProgress = 1f;

        float ncTarget = notifOpen ? 1f : 0f;
        notifCenterProgress += (ncTarget - notifCenterProgress) * 0.1f;
        if (notifCenterProgress < 0.005f) notifCenterProgress = 0f;
        if (notifCenterProgress > 0.995f) notifCenterProgress = 1f;

        float stTarget = settingsOpen ? 1f : 0f;
        settingsProgress += (stTarget - settingsProgress) * 0.1f;
        if (settingsProgress < 0.005f) settingsProgress = 0f;
        if (settingsProgress > 0.995f) settingsProgress = 1f;

        float combatTarget = combatActive ? 1f : 0f;
        combatProgress += (combatTarget - combatProgress) * 0.12f;
        if (combatProgress < 0.005f) combatProgress = 0f;
        if (combatProgress > 0.995f) combatProgress = 1f;

        float mediaTarget = mediaOpen ? 1f : 0f;
        mediaProgress += (mediaTarget - mediaProgress) * 0.1f;
        if (mediaProgress < 0.005f) mediaProgress = 0f;
        if (mediaProgress > 0.995f) mediaProgress = 1f;

        float drawerTarget = drawerOpen ? 1f : 0f;
        appDrawerProgress += (drawerTarget - appDrawerProgress) * 0.12f;
        if (appDrawerProgress < 0.005f) appDrawerProgress = 0f;
        if (appDrawerProgress > 0.995f) appDrawerProgress = 1f;

        int x = (int)(screenW / 2f - currentWidth / 2f);
        int y = (int) currentY;
        int w = (int) currentWidth;
        int h = (int) currentHeight;
        if (w < 10 || h < 10) return;

        // ══════════════════════════════════════════════
        // PILL BACKGROUND
        // ══════════════════════════════════════════════

        int bgAlpha = showCombat ? 0xAA : (hasNotif ? (int)(0xEE * notifAlpha) : 0xEE);
        ThemeManager.Theme theme = ThemeManager.current();
        int bgColor;
        if (showCombat) bgColor = 0x1A0505;
        else if (isAlert) bgColor = 0x250505;
        else if (showDeath) bgColor = 0x180505;
        else if (showMusic && theme.useAlbumArt && albumTintColor != 0x0A0A0A) bgColor = albumTintColor;
        else if (showMusic && albumTintColor != 0x0A0A0A) bgColor = albumTintColor;
        else bgColor = theme.bgColor;

        int bg = (bgAlpha << 24) | bgColor;
        int radius = Math.min(h / 2, 16);
        drawRoundedRect(ctx, x, y, w, h, radius, bg);

        // Theme border glow
        if (theme.borderGlow != 0 && !showCombat) {
            drawRoundedRect(ctx, x - 1, y - 1, w + 2, h + 2, radius + 1, theme.borderGlow);
            drawRoundedRect(ctx, x, y, w, h, radius, bg); // redraw bg on top
        }
        // Combat border glow (red pulse)
        if (showCombat && combatProgress > 0.01f) {
            int pulseAlpha = (int)(0x40 * combatProgress * (0.6f + 0.4f * (float)Math.sin(System.currentTimeMillis() / 200.0)));
            pulseAlpha = Math.max(0, Math.min(0xFF, pulseAlpha));
            drawRoundedRect(ctx, x - 1, y - 1, w + 2, h + 2, radius + 1, (pulseAlpha << 24) | 0xFF3333);
            drawRoundedRect(ctx, x, y, w, h, radius, bg);
        }

        if (!hasNotif || notifAlpha > 0.5f) {
            ctx.fill(x + radius, y + 1, x + w - radius, y + 2, 0x0CFFFFFF);
        }

        float shimmerX = (shimmerPhase - 0.5f) * w * 2;
        int sL = x + Math.max(0, (int) shimmerX);
        int sR = x + Math.min(w, (int)(shimmerX + w * 0.3f));
        if (sL < sR && sL < x + w && sR > x) {
            sL = Math.max(sL, x + radius);
            sR = Math.min(sR, x + w - radius);
            if (sL < sR) ctx.fill(sL, y + 1, sR, y + h - 1, 0x06FFFFFF);
        }

        // ══════════════════════════════════════════════
        // CONTENT (hidden when Pebble is taking over)
        // ══════════════════════════════════════════════

      if (pebbleProgress < 0.3f && notifCenterProgress < 0.3f && settingsProgress < 0.3f && mediaProgress < 0.3f && appDrawerProgress < 0.3f) {

        if (hasNotif) {
            int textAlpha = (int)(0xDD * notifAlpha);
            int textColor = (textAlpha << 24) | 0xDDDDDD;
            int textY = y + (h - 7) / 2;

            // Player head for nearby player alerts
            if (GameAlerts.hasNotificationHead()) {
                int headSize = 14;
                int totalW = headSize + 4 + font.getWidth(center);
                int startX = screenW / 2 - totalW / 2;

                // Draw 8x8 face from skin texture (UV: 8,8 to 16,16 in 64x64 skin)
                ctx.drawTexture(GameAlerts.notificationHeadTexture,
                    startX, y + (h - headSize) / 2,
                    headSize, headSize,
                    8f, 8f, 8, 8, 64, 64);
                // Draw hat overlay layer (UV: 40,8 to 48,16)
                ctx.drawTexture(GameAlerts.notificationHeadTexture,
                    startX, y + (h - headSize) / 2,
                    headSize, headSize,
                    40f, 8f, 8, 8, 64, 64);

                ctx.drawTextWithShadow(font, center, startX + headSize + 4, textY, textColor);
            } else {
                ctx.drawTextWithShadow(font, center, screenW / 2 - font.getWidth(center) / 2, textY, textColor);
            }
        } else if (!com.cobble.dynamicisland.protection.LoomShield.recentBlocks.isEmpty() && !showCombat) {
            // ── LOOM SHIELD ALERT ──
            com.cobble.dynamicisland.protection.LoomShield.recentBlocks.removeIf(
                com.cobble.dynamicisland.protection.LoomShield.BlockedEvent::isExpired);
            if (!com.cobble.dynamicisland.protection.LoomShield.recentBlocks.isEmpty()) {
                var latest = com.cobble.dynamicisland.protection.LoomShield.recentBlocks.get(
                    com.cobble.dynamicisland.protection.LoomShield.recentBlocks.size() - 1);
                float age = (System.currentTimeMillis() - latest.timestamp) / 4000f;
                int shieldAlpha = (int)(0xDD * (1f - age));
                if (shieldAlpha > 0) {
                    String shieldText = "\u26E8 " + latest.type;
                    int shieldColor = (shieldAlpha << 24) | 0x55FF55;
                    ctx.drawTextWithShadow(font, shieldText,
                        screenW / 2 - font.getWidth(shieldText) / 2,
                        y + (h - 7) / 2, shieldColor);
                }
            }
        } else if (showCombat) {
            // ── COMBAT HUD ──

            if (CombatTracker.isCelebrating()) {
                // ── KILL CELEBRATION ──
                long elapsed = System.currentTimeMillis() - CombatTracker.killCelebrationTime;
                float celebAlpha = elapsed < 2500 ? 1.0f : 1.0f - ((elapsed - 2500) / 500f);
                celebAlpha = Math.max(0, Math.min(1, celebAlpha));
                int ca = (int)(0xFF * celebAlpha);

                String killText = "✦ Eliminated " + CombatTracker.killedPlayerName;
                int ktW = font.getWidth(killText);

                // Gold glow border
                float pulse = (float)(0.5 + 0.5 * Math.sin(elapsed * 0.008));
                int glowAlpha = (int)(0x40 * pulse * celebAlpha);
                drawRoundedRect(ctx, x - 2, y - 2, w + 4, h + 4, 14, (glowAlpha << 24) | 0xFFD700);

                ctx.drawTextWithShadow(font, killText, screenW / 2 - ktW / 2, y + (h - 7) / 2, (ca << 24) | 0xFFD700);

            } else {
                // ── NORMAL COMBAT HUD ──
                int ca = Math.max(0xAA, (int)(0xFF * combatProgress));
                int headSize = 16;
                int headX = x + 6;
                int headY = y + 4;

                if (CombatTracker.opponentSkinTexture != null) {
                    ctx.drawTexture(CombatTracker.opponentSkinTexture,
                        headX, headY, headSize, headSize, 8f, 8f, 8, 8, 64, 64);
                    ctx.drawTexture(CombatTracker.opponentSkinTexture,
                        headX, headY, headSize, headSize, 40f, 8f, 8, 8, 64, 64);
                } else {
                    drawRoundedRect(ctx, headX, headY, headSize, headSize, 3, 0xFF333333);
                }

                int infoX = headX + headSize + 6;

                // Name + HP right-aligned
                String oppName = CombatTracker.opponentName != null ? CombatTracker.opponentName : "Unknown";
                ctx.drawTextWithShadow(font, oppName, infoX, y + 5, 0xFFFFFFFF);
                String hpStr = (int)CombatTracker.opponentHealth + "/" + (int)CombatTracker.opponentMaxHealth;
                ctx.drawTextWithShadow(font, hpStr, x + w - font.getWidth(hpStr) - 8, y + 5, 0x99AAAAAA);

                // Hearts row
                int heartY2 = y + 17;
                int fullHearts = (int)(CombatTracker.opponentHealth / 2);
                boolean halfHeart = (CombatTracker.opponentHealth % 2) >= 1;
                int totalHearts = Math.max(1, (int)(CombatTracker.opponentMaxHealth / 2));
                String heartChar = "\u2764";
                int charW2 = font.getWidth(heartChar);

                for (int i = 0; i < totalHearts; i++) {
                    int hx = infoX + i * charW2;
                    if (hx + charW2 > x + w - 8) break;
                    if (i < fullHearts) {
                        ctx.drawTextWithShadow(font, heartChar, hx, heartY2, 0xFFFF4444);
                    } else if (i == fullHearts && halfHeart) {
                        int halfW = charW2 / 2;
                        ctx.enableScissor(hx, heartY2 - 1, hx + halfW, heartY2 + 9);
                        ctx.drawTextWithShadow(font, heartChar, hx, heartY2, 0xFFFF4444);
                        ctx.disableScissor();
                        ctx.enableScissor(hx + halfW, heartY2 - 1, hx + charW2 + 1, heartY2 + 9);
                        ctx.drawTextWithShadow(font, heartChar, hx, heartY2, 0xFF333333);
                        ctx.disableScissor();
                    } else {
                        ctx.drawTextWithShadow(font, heartChar, hx, heartY2, 0xFF333333);
                    }
                }

                // Weapon text
                int weapTxtY = y + 28;
                if (CombatTracker.opponentWeaponName != null) {
                    String wpn = "\u2694 " + CombatTracker.opponentWeaponName;
                    int maxWpnW = w - (infoX - x) - 8;
                    if (font.getWidth(wpn) > maxWpnW) {
                        while (font.getWidth(wpn + "\u2026") > maxWpnW && wpn.length() > 3) wpn = wpn.substring(0, wpn.length() - 1);
                        wpn += "\u2026";
                    }
                    ctx.drawTextWithShadow(font, wpn, infoX, weapTxtY, 0x99BBBBBB);
                }

                // Equipment row: [armor x4] | [weapon] [offhand]
                int equipY = y + 40;
                int iSz = 12;
                int iGap = 2;

                ItemStack[] armor = {
                    CombatTracker.opponentHelmet, CombatTracker.opponentChestplate,
                    CombatTracker.opponentLeggings, CombatTracker.opponentBoots
                };

                for (int i = 0; i < armor.length; i++) {
                    int ix = infoX + i * (iSz + iGap);
                    drawCombatItem(ctx, armor[i], ix, equipY, iSz);
                }

                // Divider
                int divX = infoX + 4 * (iSz + iGap) + 1;
                ctx.fill(divX, equipY + 1, divX + 1, equipY + iSz - 1, 0x40FFFFFF);

                // Weapon item
                drawCombatItem(ctx, CombatTracker.opponentWeaponStack, divX + 3, equipY, iSz);

                // Off-hand
                if (CombatTracker.opponentOffhand != null && !CombatTracker.opponentOffhand.isEmpty()) {
                    drawCombatItem(ctx, CombatTracker.opponentOffhand, divX + 3 + iSz + iGap, equipY, iSz);
                }

                // Potion effects
                if (!CombatTracker.opponentEffects.isEmpty()) {
                    int effY = equipY + iSz + 5;
                    int effX = infoX;
                    for (String eff : CombatTracker.opponentEffects) {
                        int ew = font.getWidth(eff);
                        if (effX + ew > x + w - 8) { ctx.drawTextWithShadow(font, "\u2026", effX, effY, 0x55AACCFF); break; }
                        ctx.drawTextWithShadow(font, eff, effX, effY, 0x99AACCFF);
                        effX += ew + 6;
                    }
                }
            }

        } else if (showWaypoint) {
            // ── WAYPOINT NAVIGATION (death-style 3-line) ──
            WaypointManager.Waypoint wp = WaypointManager.activeWaypoint;
            String header = "NAVIGATING";
            String wpCoords = wp.x + " " + wp.y + " " + wp.z;
            ctx.drawTextWithShadow(font, header, screenW / 2 - font.getWidth(header) / 2, y + 5, 0x777777);
            ctx.drawTextWithShadow(font, center, screenW / 2 - font.getWidth(center) / 2, y + 16, 0xFFFFFF);
            ctx.drawTextWithShadow(font, wpCoords, screenW / 2 - font.getWidth(wpCoords) / 2, y + 28, 0x555555);

            // Coord feedback overlay
            if (coordFeedback != null) {
                ctx.drawTextWithShadow(font, coordFeedback, x + w - font.getWidth(coordFeedback) - 8, y + 28, 0xFF44DD44);
            }

        } else if (TimerManager.hasFinishedTimer()) {
            // ── TIMER FINISHED (persistent) ──
            String header = "TIMER";
            String finishText = "⏱ " + TimerManager.finishedTimerName + " finished!";
            String hint = "auto-dismiss in " + Math.max(0, (int)((TimerManager.finishedTimerEndTime + 10000 - System.currentTimeMillis()) / 1000)) + "s";
            ctx.drawTextWithShadow(font, header, screenW / 2 - font.getWidth(header) / 2, y + 5, 0x777777);
            ctx.drawTextWithShadow(font, finishText, screenW / 2 - font.getWidth(finishText) / 2, y + 16, 0xFF00AAFF);
            ctx.drawTextWithShadow(font, hint, screenW / 2 - font.getWidth(hint) / 2, y + 28, 0x555555);

        } else if (TimerManager.isInCountdown()) {
            // ── TIMER COUNTDOWN (last 10 seconds) ──
            long remaining = TimerManager.getRemaining(TimerManager.countdownTimer);
            String countStr = TimerManager.formatCountdown(remaining);
            String timerName = "⏱ " + TimerManager.countdownTimer.name;

            // Large countdown number
            ctx.drawTextWithShadow(font, timerName, screenW / 2 - font.getWidth(timerName) / 2, y + 5, 0x888888);
            // Big countdown
            String bigCount = countStr + "s";
            ctx.drawTextWithShadow(font, bigCount, screenW / 2 - font.getWidth(bigCount) / 2, y + 17, 0xFF00AAFF);

        } else if (showDeath) {
            String header = "FINDING";
            String coords = GameAlerts.getDeathCoords();
            ctx.drawTextWithShadow(font, header, screenW / 2 - font.getWidth(header) / 2, y + 5, 0x777777);
            ctx.drawTextWithShadow(font, center, screenW / 2 - font.getWidth(center) / 2, y + 16, 0xFFFFFF);
            ctx.drawTextWithShadow(font, coords, screenW / 2 - font.getWidth(coords) / 2, y + 28, 0x555555);

        // Background media playback indicator — styled like music player (BEFORE idle text!)
        } else if (MediaViewer.isPlayingInBackground() && !mediaOpen && !hasNotif && !showCombat) {
            int compactH = 34;
            int sourceColor = MediaViewer.mediaType == MediaViewer.MediaType.TWITCH ? 0x9146FF : 0xFF0000;
            boolean isPlaying = MediaViewer.isPlaying();

            // Source logo (pixel art icon)
            boolean isTwitch = MediaViewer.mediaType == MediaViewer.MediaType.TWITCH;
            int badgeW = 14;
            int badgeH = 10;
            int badgeX = x + 6;
            int badgeY = y + (compactH - badgeH) / 2;
            if (!isTwitch) {
                // YouTube logo: red rounded rect + white play triangle
                drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 3, 0xFFFF0000);
                ctx.fill(badgeX + 5, badgeY + 2, badgeX + 6, badgeY + 8, 0xFFFFFFFF);
                ctx.fill(badgeX + 6, badgeY + 3, badgeX + 7, badgeY + 7, 0xFFFFFFFF);
                ctx.fill(badgeX + 7, badgeY + 3, badgeX + 8, badgeY + 7, 0xFFFFFFFF);
                ctx.fill(badgeX + 8, badgeY + 4, badgeX + 9, badgeY + 6, 0xFFFFFFFF);
                ctx.fill(badgeX + 9, badgeY + 4, badgeX + 10, badgeY + 6, 0xFFFFFFFF);
            } else {
                // Twitch logo: purple speech bubble with eyes
                drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 3, 0xFF9146FF);
                ctx.fill(badgeX + 4, badgeY + 3, badgeX + 5, badgeY + 6, 0xFFFFFFFF);
                ctx.fill(badgeX + 8, badgeY + 3, badgeX + 9, badgeY + 6, 0xFFFFFFFF);
            }

            // Title + source label
            int textX = badgeX + badgeW + 5;
            String bgTitle = MediaViewer.currentTitle;
            int titleMaxW3 = w - badgeW - 42;
            if (font.getWidth(bgTitle) > titleMaxW3) {
                while (font.getWidth(bgTitle + "...") > titleMaxW3 && bgTitle.length() > 1)
                    bgTitle = bgTitle.substring(0, bgTitle.length() - 1);
                bgTitle += "...";
            }
            ctx.drawTextWithShadow(font, bgTitle, textX, y + 7, 0xFFDDDDDD);
            String sourceLabel2 = MediaViewer.mediaType == MediaViewer.MediaType.TWITCH ? "Twitch" : "YouTube";
            ctx.drawTextWithShadow(font, sourceLabel2, textX, y + 18, 0xFF888888);

            // EQ bars (like music player)
            int eqX = x + w - 18;
            int eqY = y + 8;
            long nowMs = System.currentTimeMillis();
            if (isPlaying) {
                int eqColor = 0xFF000000 | sourceColor;
                drawEqBar(ctx, eqX,     eqY, 3, 14, eqColor, nowMs, 1.0, 0.0);
                drawEqBar(ctx, eqX + 4, eqY, 3, 14, eqColor, nowMs, 1.4, 1.5);
                drawEqBar(ctx, eqX + 8, eqY, 3, 14, eqColor, nowMs, 0.9, 3.0);
            } else {
                ctx.fill(eqX, eqY + 7, eqX + 3, eqY + 14, 0xFF666666);
                ctx.fill(eqX + 4, eqY + 4, eqX + 7, eqY + 14, 0xFF666666);
                ctx.fill(eqX + 8, eqY + 9, eqX + 11, eqY + 14, 0xFF666666);
            }

            // Progress bar at bottom (like music player)
            long pos = MediaViewer.getPosition();
            long dur = MediaViewer.getDuration();
            int barY3 = y + compactH - 4;
            int barX3 = x + 14;
            int barW3 = w - 28;
            ctx.fill(barX3, barY3, barX3 + barW3, barY3 + 2, 0x30FFFFFF);
            if (dur > 0) {
                int filled = (int)(barW3 * pos / (float) dur);
                if (filled > 0) ctx.fill(barX3, barY3, barX3 + filled, barY3 + 2, 0xFF000000 | sourceColor);
            }

        // Browser background playback indicator
        } else if (InGameBrowser.isPlayingInBackground() && !mediaOpen && !hasNotif && !showCombat) {
            int compactH = 34;
            String currentUrl = InGameBrowser.getCurrentUrl();
            boolean isTwitch = currentUrl.contains("twitch.tv");
            int sourceColor = isTwitch ? 0x9146FF : 0xFF0000;

            // Source logo (pixel art YouTube/Twitch icon)
            int badgeW = 14;
            int badgeH = 10;
            int badgeX = x + 6;
            int badgeY = y + (compactH - badgeH) / 2;
            if (!isTwitch) {
                // YouTube logo: red rounded rect + white play triangle
                drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 3, 0xFFFF0000);
                ctx.fill(badgeX + 5, badgeY + 2, badgeX + 6, badgeY + 8, 0xFFFFFFFF);
                ctx.fill(badgeX + 6, badgeY + 3, badgeX + 7, badgeY + 7, 0xFFFFFFFF);
                ctx.fill(badgeX + 7, badgeY + 3, badgeX + 8, badgeY + 7, 0xFFFFFFFF);
                ctx.fill(badgeX + 8, badgeY + 4, badgeX + 9, badgeY + 6, 0xFFFFFFFF);
                ctx.fill(badgeX + 9, badgeY + 4, badgeX + 10, badgeY + 6, 0xFFFFFFFF);
            } else {
                // Twitch logo: purple speech bubble with eyes
                drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 3, 0xFF9146FF);
                ctx.fill(badgeX + 4, badgeY + 3, badgeX + 5, badgeY + 6, 0xFFFFFFFF);
                ctx.fill(badgeX + 8, badgeY + 3, badgeX + 9, badgeY + 6, 0xFFFFFFFF);
            }

            // Title
            int textX = badgeX + badgeW + 5;
            String bgTitle = InGameBrowser.pageTitle;
            if (bgTitle.isEmpty()) bgTitle = isTwitch ? "Twitch" : "YouTube";
            int titleMaxW3 = w - badgeW - 42;
            if (font.getWidth(bgTitle) > titleMaxW3) {
                while (font.getWidth(bgTitle + "...") > titleMaxW3 && bgTitle.length() > 1)
                    bgTitle = bgTitle.substring(0, bgTitle.length() - 1);
                bgTitle += "...";
            }
            ctx.drawTextWithShadow(font, bgTitle, textX, y + 7, 0xFFDDDDDD);
            String sourceLabel = isTwitch ? "Twitch" : "YouTube";
            ctx.drawTextWithShadow(font, sourceLabel, textX, y + 18, 0xFF888888);

            // Animated EQ bars
            int eqX = x + w - 18;
            int eqY = y + 8;
            long nowMs = System.currentTimeMillis();
            int eqColor = 0xFF000000 | sourceColor;
            drawEqBar(ctx, eqX,     eqY, 3, 14, eqColor, nowMs, 1.0, 0.0);
            drawEqBar(ctx, eqX + 4, eqY, 3, 14, eqColor, nowMs, 1.4, 1.5);
            drawEqBar(ctx, eqX + 8, eqY, 3, 14, eqColor, nowMs, 0.9, 3.0);

        } else if (!center.isEmpty() && !showMusic) {
            int textY = y + ((h - (showBiome ? 12 : 0)) - 7) / 2;
            int textColor = theme.textColor;
            ctx.drawTextWithShadow(font, center, screenW / 2 - font.getWidth(center) / 2, textY, textColor);

            // Coord feedback overlay
            if (coordFeedback != null) {
                ctx.drawTextWithShadow(font, coordFeedback, x + w - font.getWidth(coordFeedback) - 8, textY, 0xFF44DD44);
            }
        } else if (showMusic) {
            int compactH = 34;
            int artSize = 22;
            int artX = x + 5;
            int artY = y + (compactH - artSize) / 2;

            if (albumTextureId != null && !albumLoading) {
                ctx.drawTexture(albumTextureId, artX, artY, 0, 0, artSize, artSize, artSize, artSize);
                drawCircleMask(ctx, artX, artY, artSize, bg);
            } else {
                drawFilledCircle(ctx, artX, artY, artSize, 0xFF1A1A1A);
            }

            int textX = artX + artSize + 6;
            ctx.drawTextWithShadow(font, line1, textX, y + 7, 0xDDDDDD);
            ctx.drawTextWithShadow(font, line2, textX, y + 18, 0x888888);

            int eqX = x + w - 18;
            int eqY = y + 8;
            long now = System.currentTimeMillis();

            if (musicPlaying) {
                int eqColor = 0xFF55DD55;
                drawEqBar(ctx, eqX,     eqY, 3, 14, eqColor, now, 1.0, 0.0);
                drawEqBar(ctx, eqX + 4, eqY, 3, 14, eqColor, now, 1.4, 1.5);
                drawEqBar(ctx, eqX + 8, eqY, 3, 14, eqColor, now, 0.9, 3.0);
            } else {
                ctx.fill(eqX, eqY + 7, eqX + 3, eqY + 14, 0xFF666666);
                ctx.fill(eqX + 4, eqY + 4, eqX + 7, eqY + 14, 0xFF666666);
                ctx.fill(eqX + 8, eqY + 9, eqX + 11, eqY + 14, 0xFF666666);
            }

            boolean lyricsActive = DynamicIslandMod.isLyricsMode && state.spotify.lyrics != null && state.spotify.lyrics.length > 0;

            // ── Progress bar (hide during lyrics) ──
            if (!lyricsActive) {
                int barY = y + compactH - 4;
                int barX = x + 14;
                int barW = w - 28;
                ctx.fill(barX, barY, barX + barW, barY + 2, 0x30FFFFFF);
                int filled = (int)(barW * displayProgress);
                if (filled > 0) ctx.fill(barX, barY, barX + filled, barY + 2, 0xAAFFFFFF);
            }

            if (expandProgress > 0.01f && !lyricsActive) {
                int controlsY = y + compactH + (int)(2 * expandProgress);
                long estimatedMs = (long)(displayProgress * serverDuration);
                String timeStr = formatMs(estimatedMs) + " / " + formatMs(serverDuration);
                int timeColor = ((int)(0xAA * expandProgress) << 24) | 0xAAAAAA;
                ctx.drawTextWithShadow(font, timeStr, x + 8, controlsY + 2, timeColor);

                String controls = "M: collapse";
                int ctrlColor = ((int)(0x66 * expandProgress) << 24) | 0x888888;
                ctx.drawTextWithShadow(font, controls, x + w - font.getWidth(controls) - 8, controlsY + 2, ctrlColor);
            }

            // ── Lyrics rendering ───────────────────
            if (lyricsActive) {
                LauncherState.LyricsLine[] lyrics = state.spotify.lyrics;

                // Divider between music header and lyrics
                int divY = y + compactH + 1;
                ctx.fill(x + 12, divY, x + w - 12, divY + 1, 0x20FFFFFF);

                // Use real-time position (not interpolated) for accurate sync
                long realMs;
                if (serverPlaying && serverDuration > 0) {
                    long elapsed = System.currentTimeMillis() - serverUpdateTime;
                    realMs = (long)(serverProgress * serverDuration) + elapsed;
                } else {
                    realMs = (long)(serverProgress * serverDuration);
                }

                // Find current line based on real-time position
                int currentIdx = 0;
                for (int i = 0; i < lyrics.length; i++) {
                    if (lyrics[i].time <= realMs + 3000) currentIdx = i;
                    else break;
                }

                // Smooth scroll
                float targetScroll = currentIdx;
                lyricsScrollOffset += (targetScroll - lyricsScrollOffset) * 0.12f;
                float frac = lyricsScrollOffset - (int) lyricsScrollOffset;

                int lineH = 14;
                // Center lyrics in usable area (below header, above progress bar)
                int lyricsMidY = y + compactH + (h - compactH) / 2 + 5;
                int scrollPx = (int)(frac * lineH);

                int greenColor = 0xFF1DB954;
                int dimColor = 0x44AAAAAA;
                int baseIdx = (int) lyricsScrollOffset;

                for (int offset = -1; offset <= 1; offset++) {
                    int idx = baseIdx + offset;
                    if (idx < 0 || idx >= lyrics.length) continue;

                    String lyricText = lyrics[idx].text;
                    int maxLW = w - 24;
                    if (font.getWidth(lyricText) > maxLW) {
                        while (font.getWidth(lyricText + "...") > maxLW && lyricText.length() > 0)
                            lyricText = lyricText.substring(0, lyricText.length() - 1);
                        lyricText += "...";
                    }

                    int drawY = lyricsMidY + (offset * lineH) - scrollPx - 4;
                    int color = (offset == 0) ? greenColor : dimColor;
                    int lyricX = screenW / 2 - font.getWidth(lyricText) / 2;
                    ctx.drawTextWithShadow(font, lyricText, lyricX, drawY, color);
                }

                // Thin green progress at very bottom
                int pbarY = y + h - 2;
                int pbarX = x + 16;
                int pbarW = w - 32;
                ctx.fill(pbarX, pbarY, pbarX + pbarW, pbarY + 1, 0x15FFFFFF);
                int pFilled = (int)(pbarW * displayProgress);
                if (pFilled > 0) ctx.fill(pbarX, pbarY, pbarX + pFilled, pbarY + 1, 0x661DB954);

                String hint = "K: close";
                ctx.drawTextWithShadow(font, hint, x + w - font.getWidth(hint) - 10, y + h - 11, 0x22888888);
            }
        }

       } // end panel content gate

        // ── Coordinate click handling ──────────────
        if (DynamicIslandMod.displayedCoords != null && client.currentScreen == null) {
            // Check if mouse is over the pill
            double mx = client.mouse.getX() / client.getWindow().getScaleFactor();
            double my = client.mouse.getY() / client.getWindow().getScaleFactor();
            if (mx >= x && mx <= x + w && my >= y && my <= y + h) {
                // Left click = copy, Right click = share
                if (org.lwjgl.glfw.GLFW.glfwGetMouseButton(client.getWindow().getHandle(), 0) == 1) {
                    client.keyboard.setClipboard(DynamicIslandMod.displayedCoords);
                    coordFeedback = "Copied!";
                    coordFeedbackUntil = System.currentTimeMillis() + 2000;
                    DynamicIslandMod.displayedCoords = null; // prevent repeat
                } else if (org.lwjgl.glfw.GLFW.glfwGetMouseButton(client.getWindow().getHandle(), 1) == 1) {
                    client.getNetworkHandler().sendChatMessage("My location is " + DynamicIslandMod.displayedCoords);
                    coordFeedback = "Shared!";
                    coordFeedbackUntil = System.currentTimeMillis() + 2000;
                    DynamicIslandMod.displayedCoords = null;
                }
            }
        }

        // Biome footnote
        if (showBiome && !hasNotif && pebbleProgress < 0.1f && notifCenterProgress < 0.1f && settingsProgress < 0.1f && mediaProgress < 0.1f && GameAlerts.biomeSubtitle != null) {
            String biome = GameAlerts.biomeSubtitle;
            ctx.drawTextWithShadow(font, biome, screenW / 2 - font.getWidth(biome) / 2, y + h - 10, 0x666666);
        }

        // ════════════════════════════════════════════════
        // PEBBLE CHAT (inside the pill)
        // ════════════════════════════════════════════════
        if (pebbleOpen && pebbleProgress > 0.01f) {
            int pa = (int)(0xFF * pebbleProgress);

            // Header: "Loomie AI" with purple cross accent
            int headerY = y + 6;
            int accentColor = (pa << 24) | 0x9B7DFF;
            int titleColor = (pa << 24) | 0xFFFFFF;
            int subtitleColor = ((int)(0x77 * pebbleProgress) << 24) | 0x777777;

            // Purple cross icon
            ctx.fill(x + 10, headerY + 1, x + 17, headerY + 6, accentColor);
            ctx.fill(x + 12, headerY - 1, x + 15, headerY + 8, accentColor);
            ctx.drawTextWithShadow(font, "Loomie", x + 20, headerY, titleColor);
            ctx.drawTextWithShadow(font, "AI", x + 20 + font.getWidth("Loomie "), headerY, subtitleColor);

            // Separator
            int sepY = headerY + 12;
            ctx.fill(x + 8, sepY, x + w - 8, sepY + 1, ((int)(0x20 * pebbleProgress) << 24) | 0xFFFFFF);

            // Message area
            int msgTop = sepY + 3;
            int inputH = 18;
            int msgBottom = y + h - inputH - 6;
            int msgAreaH = msgBottom - msgTop;
            int contentW = w - 20;

            // Calculate total content height
            java.util.List<DynamicIslandMod.PebbleChatMsg> msgs = DynamicIslandMod.pebbleMessages;
            int totalH = 4;
            for (DynamicIslandMod.PebbleChatMsg msg : msgs) {
                totalH += pebbleBubbleH(font, msg.text, contentW) + 5;
            }
            if (DynamicIslandMod.pebbleWaiting) totalH += 16;

            // Clamp scroll
            int overflow = Math.max(0, totalH - msgAreaH);
            DynamicIslandMod.pebbleScroll = Math.max(0, Math.min(DynamicIslandMod.pebbleScroll, overflow));

            int startY;
            if (totalH <= msgAreaH) {
                startY = msgTop;
            } else {
                startY = msgTop - (totalH - msgAreaH) + DynamicIslandMod.pebbleScroll;
            }

            ctx.enableScissor(x + 2, msgTop, x + w - 2, msgBottom);

            int my = startY;
            for (DynamicIslandMod.PebbleChatMsg msg : msgs) {
                int bubbleH = pebbleBubbleH(font, msg.text, contentW);
                java.util.List<String> lines = pebbleWrap(font, msg.text, contentW - 14);
                int textMaxW = 0;
                for (String l : lines) textMaxW = Math.max(textMaxW, font.getWidth(l));
                int bW = Math.min(contentW, textMaxW + 16);

                if (msg.isUser) {
                    // User: right-aligned, dark bg
                    int bX = x + w - 10 - bW;
                    drawRoundedRect(ctx, bX, my, bW, bubbleH, 5, ((int)(0xDD * pebbleProgress) << 24) | 0x2A2A2A);
                    int ly = my + 5;
                    for (String l : lines) {
                        ctx.drawTextWithShadow(font, l, bX + 7, ly, titleColor);
                        ly += 10;
                    }
                } else {
                    // Pebble: left-aligned, accent bar
                    int bX = x + 10;
                    drawRoundedRect(ctx, bX, my, bW, bubbleH, 5, ((int)(0xDD * pebbleProgress) << 24) | 0x1E1E1E);
                    ctx.fill(bX + 1, my + 4, bX + 3, my + bubbleH - 4, accentColor);
                    int ly = my + 5;
                    for (String l : lines) {
                        ctx.drawTextWithShadow(font, l, bX + 8, ly, titleColor);
                        ly += 10;
                    }
                }
                my += bubbleH + 5;
            }

            // Typing indicator
            if (DynamicIslandMod.pebbleWaiting) {
                long now = System.currentTimeMillis();
                if (now - DynamicIslandMod.pebbleLastDotTime > 350) {
                    DynamicIslandMod.pebbleTypingDots = (DynamicIslandMod.pebbleTypingDots + 1) % 4;
                    DynamicIslandMod.pebbleLastDotTime = now;
                }
                for (int i = 0; i < 3; i++) {
                    int dotA = (i < DynamicIslandMod.pebbleTypingDots) ? (int)(0xDD * pebbleProgress) : (int)(0x33 * pebbleProgress);
                    ctx.fill(x + 18 + i * 7, my + 3, x + 21 + i * 7, my + 6, (dotA << 24) | 0x9B7DFF);
                }
            }

            ctx.disableScissor();

            // Empty state
            if (msgs.isEmpty() && !DynamicIslandMod.pebbleWaiting) {
                String e = "Ask anything about Minecraft...";
                int eColor = ((int)(0x55 * pebbleProgress) << 24) | 0x555555;
                ctx.drawTextWithShadow(font, e, screenW / 2 - font.getWidth(e) / 2, y + h / 2 - 4, eColor);
            }

            // Input field visual
            int inY = y + h - inputH - 3;
            int inX = x + 8;
            int inW = w - 16;
            drawRoundedRect(ctx, inX, inY, inW, inputH, 9, ((int)(0xDD * pebbleProgress) << 24) | 0x2A2A2A);

            String inputText = DynamicIslandMod.pebbleInputText;
            if (inputText.isEmpty()) {
                int phColor = ((int)(0x66 * pebbleProgress) << 24) | 0x666666;
                ctx.drawTextWithShadow(font, "Type a question...", inX + 8, inY + 5, phColor);
            } else {
                // Truncate from left if too wide
                int maxTW = inW - 18;
                String display = inputText;
                if (font.getWidth(display) > maxTW) {
                    while (font.getWidth("..." + display) > maxTW && display.length() > 0)
                        display = display.substring(1);
                    display = "..." + display;
                }
                ctx.drawTextWithShadow(font, display, inX + 8, inY + 5, titleColor);
                // Blinking cursor
                if (System.currentTimeMillis() % 1000 < 500) {
                    int curX = inX + 8 + font.getWidth(display);
                    ctx.fill(curX + 1, inY + 4, curX + 2, inY + 14, titleColor);
                }
            }

        }

        // ════════════════════════════════════════════════
        // NOTIFICATION CENTER (tabbed: Notifications | Waypoints | Timers)
        // ════════════════════════════════════════════════
        if (notifOpen && notifCenterProgress > 0.01f) {
            int pa = (int)(0xFF * notifCenterProgress);

            // Header
            int headerY = y + 6;
            int bellColor = (pa << 24) | 0xFFAA00;
            int titleColor = (pa << 24) | 0xFFFFFF;
            int dimColor = ((int)(0x66 * notifCenterProgress) << 24) | 0x888888;
            ctx.drawTextWithShadow(font, "\uD83D\uDD14", x + 10, headerY, bellColor);
            ctx.drawTextWithShadow(font, "Notification Center", x + 22, headerY, titleColor);

            // Tabs
            int tabY = headerY + 14;
            String[] ncTabs = {"Notifications", "Waypoints", "Timers"};
            int tabX = x + 10;
            for (int t = 0; t < ncTabs.length; t++) {
                boolean active = (DynamicIslandMod.notifCenterTab == t);
                int tColor = active ? ((pa << 24) | 0xFFAA00) : dimColor;
                ctx.drawTextWithShadow(font, ncTabs[t], tabX, tabY, tColor);
                if (active) {
                    int tw = font.getWidth(ncTabs[t]);
                    ctx.fill(tabX, tabY + 10, tabX + tw, tabY + 11, (pa << 24) | 0xFFAA00);
                }
                // Tab click
                if (DynamicIslandMod.notifClickPending && DynamicIslandMod.notifClickButton == 0) {
                    int cx = DynamicIslandMod.notifClickX;
                    int cy = DynamicIslandMod.notifClickY;
                    if (cx >= tabX && cx <= tabX + font.getWidth(ncTabs[t]) && cy >= tabY - 2 && cy <= tabY + 12) {
                        DynamicIslandMod.notifCenterTab = t;
                        DynamicIslandMod.notifCenterScroll = 0;
                    }
                }
                tabX += font.getWidth(ncTabs[t]) + 14;
            }

            // Separator
            int sepY = tabY + 14;
            ctx.fill(x + 8, sepY, x + w - 8, sepY + 1, ((int)(0x20 * notifCenterProgress) << 24) | 0xFFFFFF);

            int listTop = sepY + 3;
            int listBottom = y + h - 4;
            int listH = listBottom - listTop;

            ctx.enableScissor(x + 2, listTop, x + w - 2, listBottom);

            if (DynamicIslandMod.notifCenterTab == 0) {
                // ── NOTIFICATIONS TAB ──
                String clearHint = "C: clear";
                int hintColor = ((int)(0x44 * notifCenterProgress) << 24) | 0x888888;
                ctx.drawTextWithShadow(font, clearHint, x + w - font.getWidth(clearHint) - 10, listTop, hintColor);

                java.util.List<DynamicIslandMod.NotifEntry> notifs = DynamicIslandMod.notifHistory;
                int totalH = 14; // space for hint
                for (int i = 0; i < notifs.size(); i++) totalH += 14;

                int overflow = Math.max(0, totalH - listH);
                DynamicIslandMod.notifCenterScroll = Math.max(0, Math.min(DynamicIslandMod.notifCenterScroll, overflow));

                int ny = listTop + 14;
                if (totalH > listH) ny = listTop + 14 - (totalH - listH) + DynamicIslandMod.notifCenterScroll;

                long now = System.currentTimeMillis();
                for (DynamicIslandMod.NotifEntry entry : notifs) {
                    int dotColor;
                    switch (entry.type) {
                        case "whisper" -> dotColor = 0xFF9B7DFF;
                        case "health" -> dotColor = 0xFFFF4444;
                        case "hunger" -> dotColor = 0xFFCC8844;
                        case "durability" -> dotColor = 0xFFFF6600;
                        case "player" -> dotColor = 0xFF44DD44;
                        case "inventory" -> dotColor = 0xFFAAAA00;
                        case "death" -> dotColor = 0xFFDD2222;
                        case "timer" -> dotColor = 0xFF00AAFF;
                        case "waypoint" -> dotColor = 0xFF4CAF50;
                        case "combat" -> dotColor = 0xFFFF3333;
                        default -> dotColor = 0xFF888888;
                    }
                    int dotAlpha = (int)(0xFF * notifCenterProgress);
                    ctx.fill(x + 10, ny + 3, x + 13, ny + 6, (dotAlpha << 24) | (dotColor & 0xFFFFFF));

                    String notifText = entry.text;
                    int maxNW = w - 70;
                    if (font.getWidth(notifText) > maxNW) {
                        while (font.getWidth(notifText + "...") > maxNW && notifText.length() > 0)
                            notifText = notifText.substring(0, notifText.length() - 1);
                        notifText += "...";
                    }
                    ctx.drawTextWithShadow(font, notifText, x + 16, ny + 1, (pa << 24) | 0xCCCCCC);

                    String timeStr = relativeTime(now - entry.timestamp);
                    int timeCol = ((int)(0x55 * notifCenterProgress) << 24) | 0x777777;
                    ctx.drawTextWithShadow(font, timeStr, x + w - font.getWidth(timeStr) - 10, ny + 1, timeCol);
                    ny += 14;
                }

                if (notifs.isEmpty()) {
                    String e = "No notifications";
                    int eColor = ((int)(0x55 * notifCenterProgress) << 24) | 0x555555;
                    ctx.drawTextWithShadow(font, e, screenW / 2 - font.getWidth(e) / 2, y + h / 2 - 4, eColor);
                }

            } else if (DynamicIslandMod.notifCenterTab == 1) {
                // ── WAYPOINTS TAB ──
                java.util.List<WaypointManager.Waypoint> wps = WaypointManager.getWaypoints();
                int wy = listTop + 2;

                // Save current location button
                String saveBtn = "\uD83D\uDCCD Save Current Location";
                int saveBtnW = font.getWidth(saveBtn) + 12;
                drawRoundedRect(ctx, x + 10, wy, saveBtnW, 14, 4, ((int)(0xDD * notifCenterProgress) << 24) | 0x2A2A2A);
                ctx.drawTextWithShadow(font, saveBtn, x + 16, wy + 3, (pa << 24) | 0x4CAF50);

                if (DynamicIslandMod.notifClickPending && DynamicIslandMod.notifClickButton == 0) {
                    int cx = DynamicIslandMod.notifClickX;
                    int cy = DynamicIslandMod.notifClickY;
                    if (cx >= x + 10 && cx <= x + 10 + saveBtnW && cy >= wy && cy <= wy + 14) {
                        if (client.player != null) {
                            int px = (int) client.player.getX();
                            int py = (int) client.player.getY();
                            int pz = (int) client.player.getZ();
                            String dim = client.world != null ? client.world.getRegistryKey().getValue().getPath() : "overworld";
                            WaypointManager.addWaypoint("WP " + (wps.size() + 1), px, py, pz, dim);
                        }
                    }
                }

                // Cancel route button (if navigating)
                if (WaypointManager.activeWaypoint != null) {
                    wy += 18;
                    String cancelBtn = "✕ Cancel Route";
                    int cancelW = font.getWidth(cancelBtn) + 12;
                    drawRoundedRect(ctx, x + 10, wy, cancelW, 14, 4, ((int)(0xDD * notifCenterProgress) << 24) | 0x3A1A1A);
                    ctx.drawTextWithShadow(font, cancelBtn, x + 16, wy + 3, (pa << 24) | 0xFF6644);
                    if (DynamicIslandMod.notifClickPending && DynamicIslandMod.notifClickButton == 0) {
                        int cx = DynamicIslandMod.notifClickX;
                        int cy = DynamicIslandMod.notifClickY;
                        if (cx >= x + 10 && cx <= x + 10 + cancelW && cy >= wy && cy <= wy + 14) {
                            WaypointManager.cancelNavigation();
                        }
                    }
                }

                // Cancel death tracking button (if death is active)
                if (GameAlerts.deathActive) {
                    wy += 18;
                    String deathBtn = "✕ Cancel Death Tracking";
                    int deathW = font.getWidth(deathBtn) + 12;
                    drawRoundedRect(ctx, x + 10, wy, deathW, 14, 4, ((int)(0xDD * notifCenterProgress) << 24) | 0x3A1A1A);
                    ctx.drawTextWithShadow(font, deathBtn, x + 16, wy + 3, (pa << 24) | 0xFF4444);
                    if (DynamicIslandMod.notifClickPending && DynamicIslandMod.notifClickButton == 0) {
                        int cx = DynamicIslandMod.notifClickX;
                        int cy = DynamicIslandMod.notifClickY;
                        if (cx >= x + 10 && cx <= x + 10 + deathW && cy >= wy && cy <= wy + 14) {
                            GameAlerts.deathActive = false;
                            GameAlerts.deathPos = null;
                            GameAlerts.persistentText = null;
                            GameAlerts.persistentType = null;
                        }
                    }
                }

                wy += 20;

                // Waypoint list
                for (int i = 0; i < wps.size(); i++) {
                    WaypointManager.Waypoint wp = wps.get(i);
                    boolean isActive = wp == WaypointManager.activeWaypoint;

                    // Color dot
                    ctx.fill(x + 10, wy + 2, x + 14, wy + 6, wp.color);

                    // Name
                    String wpName = wp.name;
                    ctx.drawTextWithShadow(font, wpName, x + 18, wy, isActive ? ((pa << 24) | 0xFFAA00) : titleColor);

                    // Coords + dimension
                    String wpCoords = wp.x + " " + wp.y + " " + wp.z + " [" + WaypointManager.getDimensionShort(wp.dimension) + "]";
                    ctx.drawTextWithShadow(font, wpCoords, x + 18 + font.getWidth(wpName) + 6, wy, dimColor);

                    // Click to navigate
                    if (DynamicIslandMod.notifClickPending && DynamicIslandMod.notifClickButton == 0) {
                        int cx = DynamicIslandMod.notifClickX;
                        int cy = DynamicIslandMod.notifClickY;
                        if (cx >= x + 10 && cx <= x + w - 40 && cy >= wy - 2 && cy <= wy + 12) {
                            WaypointManager.startNavigation(i);
                        }
                    }

                    // Right-click to delete
                    if (DynamicIslandMod.notifClickPending && DynamicIslandMod.notifClickButton == 1) {
                        int cx = DynamicIslandMod.notifClickX;
                        int cy = DynamicIslandMod.notifClickY;
                        if (cx >= x + 10 && cx <= x + w - 10 && cy >= wy - 2 && cy <= wy + 12) {
                            WaypointManager.removeWaypoint(i);
                            break; // list modified, break out
                        }
                    }

                    wy += 14;
                }

                if (wps.isEmpty()) {
                    String e = "No waypoints saved";
                    int eColor = ((int)(0x55 * notifCenterProgress) << 24) | 0x555555;
                    ctx.drawTextWithShadow(font, e, screenW / 2 - font.getWidth(e) / 2, listTop + listH / 2 - 4, eColor);
                }

                // Count
                String countStr = wps.size() + "/20";
                ctx.drawTextWithShadow(font, countStr, x + w - font.getWidth(countStr) - 10, listTop + 2, dimColor);

            } else if (DynamicIslandMod.notifCenterTab == 2) {
                // ── TIMERS TAB (Apple-style) ──
                int ty = listTop + 2;

                // Finished timer (must dismiss)
                if (TimerManager.hasFinishedTimer()) {
                    String ft = "⏱ " + TimerManager.finishedTimerName + " finished!";
                    ctx.drawTextWithShadow(font, ft, x + 10, ty, (pa << 24) | 0x00AAFF);

                    // Dismiss X
                    String dismiss = "✕";
                    int dismissX = x + w - font.getWidth(dismiss) - 12;
                    ctx.drawTextWithShadow(font, dismiss, dismissX, ty, (pa << 24) | 0xFF4444);
                    if (DynamicIslandMod.notifClickPending && DynamicIslandMod.notifClickButton == 0) {
                        int cx = DynamicIslandMod.notifClickX;
                        int cy = DynamicIslandMod.notifClickY;
                        if (cx >= dismissX - 4 && cx <= dismissX + 12 && cy >= ty - 2 && cy <= ty + 12) {
                            TimerManager.dismissFinishedTimer();
                        }
                    }

                    // Restart button
                    String restart = "↻";
                    int restartX = dismissX - font.getWidth(restart) - 10;
                    ctx.drawTextWithShadow(font, restart, restartX, ty, (pa << 24) | 0x44DD44);
                    if (DynamicIslandMod.notifClickPending && DynamicIslandMod.notifClickButton == 0) {
                        int cx = DynamicIslandMod.notifClickX;
                        int cy = DynamicIslandMod.notifClickY;
                        if (cx >= restartX - 4 && cx <= restartX + 12 && cy >= ty - 2 && cy <= ty + 12) {
                            TimerManager.restartFinishedTimer();
                        }
                    }
                    ty += 18;
                    ctx.fill(x + 8, ty, x + w - 8, ty + 1, ((int)(0x15 * notifCenterProgress) << 24) | 0xFFFFFF);
                    ty += 6;
                }

                // Active timers
                java.util.List<TimerManager.TimerData> timers = TimerManager.getActiveTimers();
                for (int i = 0; i < timers.size(); i++) {
                    TimerManager.TimerData timer = timers.get(i);
                    long remaining = TimerManager.getRemaining(timer);
                    String timerStr = "⏱ " + timer.name + " — " + TimerManager.formatTime(remaining);
                    ctx.drawTextWithShadow(font, timerStr, x + 10, ty, titleColor);

                    String cancel = "✕";
                    int cancelX = x + w - font.getWidth(cancel) - 12;
                    ctx.drawTextWithShadow(font, cancel, cancelX, ty, (pa << 24) | 0xFF4444);
                    if (DynamicIslandMod.notifClickPending && DynamicIslandMod.notifClickButton == 0) {
                        int cx = DynamicIslandMod.notifClickX;
                        int cy = DynamicIslandMod.notifClickY;
                        if (cx >= cancelX - 4 && cx <= cancelX + 12 && cy >= ty - 2 && cy <= ty + 12) {
                            TimerManager.cancelTimer(i);
                            break;
                        }
                    }
                    ty += 16;
                }

                if (timers.isEmpty() && !TimerManager.hasFinishedTimer()) {
                    ctx.drawTextWithShadow(font, "No active timers", x + 10, ty, dimColor);
                    ty += 16;
                }

                ty += 8;
                ctx.fill(x + 8, ty, x + w - 8, ty + 1, ((int)(0x15 * notifCenterProgress) << 24) | 0xFFFFFF);
                ty += 8;

                // ── Apple-style picker (Hours : Minutes : Seconds) ──
                int pickerCenterX = screenW / 2;
                int colW = 36;
                int colGap = 8;

                // Column labels
                String[] labels = {"hours", "min", "sec"};
                int[] vals = {TimerManager.pickerHours, TimerManager.pickerMinutes, TimerManager.pickerSeconds};
                int[] maxVals = {23, 59, 59};

                for (int col = 0; col < 3; col++) {
                    int colX = pickerCenterX + (col - 1) * (colW + colGap) - colW / 2;

                    // Up arrow
                    String upArr = "▲";
                    int upX = colX + colW / 2 - font.getWidth(upArr) / 2;
                    ctx.drawTextWithShadow(font, upArr, upX, ty, dimColor);
                    if (DynamicIslandMod.notifClickPending && DynamicIslandMod.notifClickButton == 0) {
                        int cx = DynamicIslandMod.notifClickX;
                        int cy = DynamicIslandMod.notifClickY;
                        if (cx >= colX && cx <= colX + colW && cy >= ty - 2 && cy <= ty + 10) {
                            if (col == 0) TimerManager.pickerHours = (TimerManager.pickerHours + 1) % (maxVals[0] + 1);
                            else if (col == 1) TimerManager.pickerMinutes = (TimerManager.pickerMinutes + 1) % (maxVals[1] + 1);
                            else TimerManager.pickerSeconds = (TimerManager.pickerSeconds + 1) % (maxVals[2] + 1);
                        }
                    }

                    // Value
                    String valStr = String.valueOf(vals[col]);
                    drawRoundedRect(ctx, colX, ty + 12, colW, 16, 4, ((int)(0xDD * notifCenterProgress) << 24) | 0x2A2A2A);
                    ctx.drawTextWithShadow(font, valStr, colX + colW / 2 - font.getWidth(valStr) / 2, ty + 16, (pa << 24) | 0x00AAFF);

                    // Down arrow
                    String dnArr = "▼";
                    int dnX = colX + colW / 2 - font.getWidth(dnArr) / 2;
                    ctx.drawTextWithShadow(font, dnArr, dnX, ty + 32, dimColor);
                    if (DynamicIslandMod.notifClickPending && DynamicIslandMod.notifClickButton == 0) {
                        int cx = DynamicIslandMod.notifClickX;
                        int cy = DynamicIslandMod.notifClickY;
                        if (cx >= colX && cx <= colX + colW && cy >= ty + 30 && cy <= ty + 42) {
                            if (col == 0) TimerManager.pickerHours = (TimerManager.pickerHours - 1 + maxVals[0] + 1) % (maxVals[0] + 1);
                            else if (col == 1) TimerManager.pickerMinutes = (TimerManager.pickerMinutes - 1 + maxVals[1] + 1) % (maxVals[1] + 1);
                            else TimerManager.pickerSeconds = (TimerManager.pickerSeconds - 1 + maxVals[2] + 1) % (maxVals[2] + 1);
                        }
                    }

                    // Label
                    ctx.drawTextWithShadow(font, labels[col], colX + colW / 2 - font.getWidth(labels[col]) / 2, ty + 44, dimColor);
                }

                ty += 58;

                // Start button
                String startBtn = "▶ Start";
                int startW = font.getWidth(startBtn) + 16;
                int startX = pickerCenterX - startW / 2;
                drawRoundedRect(ctx, startX, ty, startW, 14, 6, ((int)(0xDD * notifCenterProgress) << 24) | 0x1A3A1A);
                ctx.drawTextWithShadow(font, startBtn, startX + 8, ty + 3, (pa << 24) | 0x44DD44);
                if (DynamicIslandMod.notifClickPending && DynamicIslandMod.notifClickButton == 0) {
                    int cx = DynamicIslandMod.notifClickX;
                    int cy = DynamicIslandMod.notifClickY;
                    if (cx >= startX && cx <= startX + startW && cy >= ty && cy <= ty + 14) {
                        TimerManager.startFromPicker();
                    }
                }
                ty += 20;

                // Presets
                ctx.drawTextWithShadow(font, "Presets", x + 10, ty, titleColor);
                ty += 14;
                String[][] quickTimers = {{"1m", "60"}, {"5m", "300"}, {"10m", "600"}, {"30m", "1800"}};
                int btnX = x + 10;
                for (String[] qt : quickTimers) {
                    int btnW = font.getWidth(qt[0]) + 10;
                    drawRoundedRect(ctx, btnX, ty, btnW, 13, 4, ((int)(0xDD * notifCenterProgress) << 24) | 0x2A2A2A);
                    ctx.drawTextWithShadow(font, qt[0], btnX + 5, ty + 3, (pa << 24) | 0x00AAFF);
                    if (DynamicIslandMod.notifClickPending && DynamicIslandMod.notifClickButton == 0) {
                        int cx = DynamicIslandMod.notifClickX;
                        int cy = DynamicIslandMod.notifClickY;
                        if (cx >= btnX && cx <= btnX + btnW && cy >= ty && cy <= ty + 13) {
                            TimerManager.startTimer(qt[0] + " Timer", Long.parseLong(qt[1]) * 1000);
                        }
                    }
                    btnX += btnW + 6;
                }
            }

            ctx.disableScissor();

            // Consume click
            DynamicIslandMod.notifClickPending = false;
        }

        // ════════════════════════════════════════════════
        // SETTINGS PANEL
        // ════════════════════════════════════════════════
        if (settingsOpen && settingsProgress > 0.01f) {
            int pa = (int)(0xFF * settingsProgress);
            int titleColor = (pa << 24) | 0xFFFFFF;
            int dimColor = ((int)(0x66 * settingsProgress) << 24) | 0x888888;

            // Header
            int headerY = y + 6;
            ctx.drawTextWithShadow(font, "\u2699", x + 10, headerY, (pa << 24) | 0xAAAAAA);
            ctx.drawTextWithShadow(font, "Settings", x + 22, headerY, titleColor);

            // Tabs
            int tabY = headerY + 14;
            String[] tabs = {"Keybinds", "Alerts", "Inventory", "Themes"};
            int tabX = x + 10;
            for (int t = 0; t < tabs.length; t++) {
                boolean active = (DynamicIslandMod.settingsTab == t);
                int tColor = active ? ((pa << 24) | 0x9B7DFF) : dimColor;
                ctx.drawTextWithShadow(font, tabs[t], tabX, tabY, tColor);
                if (active) {
                    int tw = font.getWidth(tabs[t]);
                    ctx.fill(tabX, tabY + 10, tabX + tw, tabY + 11, (pa << 24) | 0x9B7DFF);
                }

                // Handle tab clicks
                if (DynamicIslandMod.settingsClickPending) {
                    int cx = DynamicIslandMod.settingsClickX;
                    int cy = DynamicIslandMod.settingsClickY;
                    if (cx >= tabX && cx <= tabX + font.getWidth(tabs[t]) && cy >= tabY - 2 && cy <= tabY + 12) {
                        DynamicIslandMod.settingsTab = t;
                    }
                }
                tabX += font.getWidth(tabs[t]) + 14;
            }

            // Separator
            int sepY = tabY + 14;
            ctx.fill(x + 8, sepY, x + w - 8, sepY + 1, ((int)(0x15 * settingsProgress) << 24) | 0xFFFFFF);

            int contentY = sepY + 4;
            int contentBottom = y + h - 4;

            ctx.enableScissor(x + 2, contentY, x + w - 2, contentBottom);

            if (DynamicIslandMod.settingsTab == 0) {
                // KEYBINDS TAB
                String[][] keys = {
                    {"L", "Loomie AI"},
                    {"M", "Expand Music"},
                    {"K", "Lyrics"},
                    {"`", "Play/Pause"},
                    {"[", "Previous Track"},
                    {"]", "Next Track"},
                    {"N", "Notifications"},
                    {"G", "Settings"},
                    {"T", "Media Viewer"}
                };
                int ky = contentY + 2;
                for (String[] pair : keys) {
                    // Key badge
                    int kw = font.getWidth(pair[0]) + 6;
                    drawRoundedRect(ctx, x + 12, ky - 1, kw, 11, 3, ((int)(0xDD * settingsProgress) << 24) | 0x333333);
                    ctx.drawTextWithShadow(font, pair[0], x + 15, ky + 1, (pa << 24) | 0x9B7DFF);
                    ctx.drawTextWithShadow(font, pair[1], x + 12 + kw + 6, ky + 1, titleColor);
                    ky += 14;
                }
            } else if (DynamicIslandMod.settingsTab == 1) {
                // NOTIFICATIONS TAB - toggles
                String[][] toggles = {
                    {"Low Health", "toggleLowHealth"},
                    {"Low Hunger", "toggleLowHunger"},
                    {"Durability", "toggleDurability"},
                    {"Player Nearby", "togglePlayerNearby"},
                    {"Whisper/DM", "toggleWhisper"},
                    {"Biome Change", "toggleBiome"},
                    {"Inventory Full", "toggleInventoryFull"}
                };
                int ty = contentY + 2;
                for (String[] toggle : toggles) {
                    boolean val = getToggle(toggle[1]);
                    // Checkbox
                    int cbX = x + 12;
                    int cbY = ty;
                    drawRoundedRect(ctx, cbX, cbY, 9, 9, 2, ((int)(0xDD * settingsProgress) << 24) | 0x333333);
                    if (val) {
                        ctx.fill(cbX + 2, cbY + 2, cbX + 7, cbY + 7, (pa << 24) | 0x9B7DFF);
                    }
                    ctx.drawTextWithShadow(font, toggle[0], cbX + 14, cbY + 1, titleColor);

                    // Handle toggle clicks
                    if (DynamicIslandMod.settingsClickPending) {
                        int cx = DynamicIslandMod.settingsClickX;
                        int cy = DynamicIslandMod.settingsClickY;
                        if (cx >= cbX && cx <= cbX + 100 && cy >= cbY - 1 && cy <= cbY + 10) {
                            setToggle(toggle[1], !val);
                        }
                    }
                    ty += 14;
                }
            } else if (DynamicIslandMod.settingsTab == 2) {
                // INVENTORY TAB
                int iy = contentY + 4;
                ctx.drawTextWithShadow(font, "Inventory Preset", x + 12, iy, titleColor);
                iy += 14;

                if (DynamicIslandMod.hasInventoryPreset) {
                    ctx.drawTextWithShadow(font, "Layout saved \u2713", x + 12, iy, (pa << 24) | 0x44DD44);
                } else {
                    ctx.drawTextWithShadow(font, "No layout saved", x + 12, iy, dimColor);
                }
                iy += 16;

                // Save button
                int btnX = x + 12;
                int btnW = font.getWidth("Save Current Layout") + 12;
                drawRoundedRect(ctx, btnX, iy, btnW, 14, 4, ((int)(0xDD * settingsProgress) << 24) | 0x2A2A2A);
                ctx.drawTextWithShadow(font, "Save Current Layout", btnX + 6, iy + 3, (pa << 24) | 0x9B7DFF);

                if (DynamicIslandMod.settingsClickPending) {
                    int cx = DynamicIslandMod.settingsClickX;
                    int cy = DynamicIslandMod.settingsClickY;
                    if (cx >= btnX && cx <= btnX + btnW && cy >= iy && cy <= iy + 14) {
                        saveInventoryLayout();
                    }
                }
            } else if (DynamicIslandMod.settingsTab == 3) {
                // THEMES TAB
                int ty = contentY + 4;
                ctx.drawTextWithShadow(font, "Island Theme", x + 12, ty, titleColor);
                ty += 16;

                for (int i = 0; i < ThemeManager.getThemeCount(); i++) {
                    ThemeManager.Theme t = ThemeManager.themes[i];
                    boolean isActive = (i == ThemeManager.currentIndex);

                    // Color swatch
                    int swatchX = x + 12;
                    drawRoundedRect(ctx, swatchX, ty, 12, 12, 3, 0xFF000000 | t.bgColor);
                    if (t.borderGlow != 0) {
                        drawRoundedRect(ctx, swatchX - 1, ty - 1, 14, 14, 4, t.borderGlow);
                        drawRoundedRect(ctx, swatchX, ty, 12, 12, 3, 0xFF000000 | t.bgColor);
                    }
                    // Accent dot
                    ctx.fill(swatchX + 4, ty + 4, swatchX + 8, ty + 8, t.accentColor);

                    // Theme name
                    String tName = t.name;
                    int nameColor = isActive ? ((pa << 24) | 0x9B7DFF) : titleColor;
                    ctx.drawTextWithShadow(font, tName, swatchX + 18, ty + 2, nameColor);

                    // Active indicator
                    if (isActive) {
                        String check = " ✓";
                        ctx.drawTextWithShadow(font, check, swatchX + 18 + font.getWidth(tName), ty + 2, (pa << 24) | 0x44DD44);
                    }

                    // Click to select
                    if (DynamicIslandMod.settingsClickPending) {
                        int cx = DynamicIslandMod.settingsClickX;
                        int cy = DynamicIslandMod.settingsClickY;
                        if (cx >= swatchX && cx <= swatchX + 180 && cy >= ty - 2 && cy <= ty + 14) {
                            ThemeManager.setTheme(i);
                            DynamicIslandConfig.save();
                        }
                    }
                    ty += 16;
                }
            }

            ctx.disableScissor();

            // Consume click
            DynamicIslandMod.settingsClickPending = false;
        }

        // ════════════════════════════════════════════════
        // MEDIA VIEWER PANEL (Redesigned — Mouse-First)
        // ════════════════════════════════════════════════
        if (mediaOpen && mediaProgress > 0.01f) {
            int ma = (int)(0xFF * mediaProgress);
            int mx = mouseX, my = mouseY;

            // ══ IN-GAME BROWSER MODE ══
            if (InGameBrowser.isActive) {
                // Update panel coordinates for the browser
                InGameBrowser.panelX = x;
                InGameBrowser.panelY = y;
                InGameBrowser.panelW = w;
                InGameBrowser.panelH = h;

                int tabBarH = 16;
                int pad = 4;

                // Browser area (inside the panel, below tab bar)
                int bx = x + pad;
                int by = y + tabBarH + pad;
                int bw = w - pad * 2;
                int bh = h - tabBarH - pad * 2;
                InGameBrowser.browserX = bx;
                InGameBrowser.browserY = by;
                InGameBrowser.browserW = bw;
                InGameBrowser.browserH = bh;

                // Tab bar
                if (InGameBrowser.activeMode == InGameBrowser.Mode.MEDIA) {
                    int tabY = y + 3;

                    // YouTube tab with logo
                    int ytLogoW = 14; // logo + padding
                    int ytLabelW = font.getWidth("YouTube");
                    int ytW = ytLogoW + ytLabelW + 8;
                    int ytX = x + 6;
                    boolean ytActive = "youtube".equals(InGameBrowser.activeTab);
                    drawRoundedRect(ctx, ytX, tabY, ytW, 12, 4, (ma << 24) | (ytActive ? 0xCC0000 : 0x333333));
                    // Draw mini YouTube logo (red rounded rect + white triangle)
                    int logoX = ytX + 3;
                    int logoY = tabY + 2;
                    drawRoundedRect(ctx, logoX, logoY, 10, 8, 2, (ma << 24) | 0xFF0000);
                    // White play triangle (3 fill calls approximating triangle)
                    ctx.fill(logoX + 4, logoY + 2, logoX + 5, logoY + 6, (ma << 24) | 0xFFFFFF);
                    ctx.fill(logoX + 5, logoY + 3, logoX + 6, logoY + 5, (ma << 24) | 0xFFFFFF);
                    ctx.fill(logoX + 6, logoY + 3, logoX + 7, logoY + 5, (ma << 24) | 0xFFFFFF);
                    ctx.drawTextWithShadow(font, "YouTube", ytX + ytLogoW + 2, tabY + 2, (ma << 24) | 0xFFFFFF);

                    // Twitch tab with logo
                    int twLabelW = font.getWidth("Twitch");
                    int twLogoW = 12;
                    int twW = twLogoW + twLabelW + 8;
                    int twX = ytX + ytW + 3;
                    boolean twActive = "twitch".equals(InGameBrowser.activeTab);
                    drawRoundedRect(ctx, twX, tabY, twW, 12, 4, (ma << 24) | (twActive ? 0x9146FF : 0x333333));
                    // Mini Twitch icon (speech bubble shape)
                    int tLogoX = twX + 3;
                    int tLogoY = tabY + 2;
                    ctx.fill(tLogoX + 1, tLogoY, tLogoX + 7, tLogoY + 6, (ma << 24) | 0x9146FF);
                    ctx.fill(tLogoX, tLogoY + 1, tLogoX + 8, tLogoY + 5, (ma << 24) | 0x9146FF);
                    ctx.fill(tLogoX + 2, tLogoY + 6, tLogoX + 4, tLogoY + 8, (ma << 24) | 0x9146FF);
                    // White eyes on twitch logo
                    ctx.fill(tLogoX + 2, tLogoY + 2, tLogoX + 3, tLogoY + 4, (ma << 24) | 0xFFFFFF);
                    ctx.fill(tLogoX + 5, tLogoY + 2, tLogoX + 6, tLogoY + 4, (ma << 24) | 0xFFFFFF);
                    ctx.drawTextWithShadow(font, "Twitch", twX + twLogoW + 2, tabY + 2, (ma << 24) | 0xFFFFFF);

                    // Tab click handling
                    boolean hasClick = TwitchScreen.clickPending;
                    if (hasClick) {
                        int clickX = TwitchScreen.clickX, clickY = TwitchScreen.clickY;
                        if (clickY >= tabY && clickY < tabY + 12) {
                            if (clickX >= ytX && clickX < ytX + ytW) InGameBrowser.switchTab("youtube");
                            else if (clickX >= twX && clickX < twX + twW) InGameBrowser.switchTab("twitch");
                        }
                        TwitchScreen.clickPending = false;
                    }

                    // ESC hint
                    String hint = "ESC";
                    ctx.drawTextWithShadow(font, hint, x + w - font.getWidth(hint) - 6, tabY + 2, (ma << 24) | 0x666666);
                } else {
                    // General browser tab
                    int tabY = y + 3;
                    ctx.drawTextWithShadow(font, "Browser", x + 8, tabY + 2, (ma << 24) | 0x4285F4);
                    String hint = "ESC to close";
                    ctx.drawTextWithShadow(font, hint, x + w - font.getWidth(hint) - 6, tabY + 2, (ma << 24) | 0x666666);
                }

                // Render browser texture or status
                int texId = InGameBrowser.getTextureID();
                if (texId != 0 && bw > 0 && bh > 0) {
                    browserFrameCount++;
                    if (texId != lastBrowserTexId) {
                        lastBrowserTexId = texId;
                        browserGlTexId = texId;
                        MinecraftClient.getInstance().getTextureManager()
                            .registerTexture(BROWSER_TEX_ID, BROWSER_TEXTURE);
                    } else {
                        browserGlTexId = texId;
                    }

                    RenderSystem.enableBlend();
                    RenderSystem.defaultBlendFunc();
                    ctx.drawTexture(BROWSER_TEX_ID, bx, by, bw, bh, 0f, 0f, bw, bh, bw, bh);
                    RenderSystem.disableBlend();

                    InGameBrowser.resizeBrowser();
                } else if (InGameBrowser.statusMessage != null) {
                    int msgY = by + bh / 2 - 10;
                    ctx.drawCenteredTextWithShadow(font, InGameBrowser.statusMessage, x + w / 2, msgY, (ma << 24) | 0xFFAAAA);
                    if (!InGameBrowser.isMcefAvailable) {
                        ctx.drawCenteredTextWithShadow(font, "Install from modrinth.com/mod/mcef", x + w / 2, msgY + 12, (ma << 24) | 0x888888);
                    } else if (!InGameBrowser.isMcefInitialized) {
                        ctx.drawCenteredTextWithShadow(font, "Please wait...", x + w / 2, msgY + 12, (ma << 24) | 0x888888);
                    }
                } else {
                    ctx.drawCenteredTextWithShadow(font, "Loading...", x + w / 2, by + bh / 2, (ma << 24) | 0xCCCCCC);
                }

                // Blocked site toast
                if (InGameBrowser.blockedMessage != null && System.currentTimeMillis() < InGameBrowser.blockedMessageUntil) {
                    int msgW2 = font.getWidth(InGameBrowser.blockedMessage) + 14;
                    int msgX2 = x + (w - msgW2) / 2;
                    int msgY2 = y + h - 18;
                    drawRoundedRect(ctx, msgX2, msgY2, msgW2, 14, 4, (ma << 24) | 0xCC0000);
                    ctx.drawCenteredTextWithShadow(font, InGameBrowser.blockedMessage, x + w / 2, msgY2 + 3, (ma << 24) | 0xFFFFFF);
                }

            // ══ ORIGINAL MEDIA VIEWER (search + player) ══
            } else {

            boolean isSearchTab = "SEARCH".equals(MediaViewer.activeTab);

            // Consume scroll
            double scroll = TwitchScreen.scrollDelta;
            TwitchScreen.scrollDelta = 0;

            // Check for pending click
            boolean hasClick = TwitchScreen.clickPending;
            int cx = TwitchScreen.clickX, cy = TwitchScreen.clickY;

            if (isSearchTab) {
                // ══ SEARCH VIEW — Card Layout ══
                int headerY = y + 6;

                // Source filter tabs (clickable pills)
                String[] sources = {"All", "YouTube", "Twitch"};
                String[] sourceKeys = {"all", "youtube", "twitch"};
                int[] sourceColors = {0xCCCCCC, 0xFF0000, 0x9146FF};
                int tabX = x + 8;
                for (int si = 0; si < sources.length; si++) {
                    int tw = font.getWidth(sources[si]) + 10;
                    int tabH = 12;
                    boolean isActive = MediaViewer.searchSource.equals(sourceKeys[si]);
                    boolean hovered = mx >= tabX && mx < tabX + tw && my >= headerY && my < headerY + tabH;

                    // Tab pill background
                    if (isActive) {
                        drawRoundedRect(ctx, tabX, headerY, tw, tabH, 6, (ma << 24) | sourceColors[si]);
                        ctx.drawTextWithShadow(font, sources[si], tabX + 5, headerY + 2, (ma << 24) | 0xFFFFFF);
                    } else {
                        int tabBgAlpha = hovered ? 0x30 : 0x15;
                        drawRoundedRect(ctx, tabX, headerY, tw, tabH, 6, ((int)(tabBgAlpha * mediaProgress) << 24) | 0xFFFFFF);
                        int textAlpha = hovered ? 0xBB : 0x77;
                        ctx.drawTextWithShadow(font, sources[si], tabX + 5, headerY + 2, ((int)(textAlpha * mediaProgress) << 24) | 0xCCCCCC);
                    }

                    // Tab click
                    if (hasClick && cx >= tabX && cx < tabX + tw && cy >= headerY && cy < headerY + tabH) {
                        MediaViewer.searchSource = sourceKeys[si];
                        hasClick = false;
                    }
                    tabX += tw + 4;
                }

                // Search input field
                int inY = headerY + 16;
                int inX = x + 8;
                int inW = w - 16;
                int inputH = 16;
                boolean searchHovered = mx >= inX && mx < inX + inW && my >= inY && my < inY + inputH;
                int searchBg = searchHovered ? 0x222222 : 0x1A1A1A;
                drawRoundedRect(ctx, inX, inY, inW, inputH, 8, ((int)(0xCC * mediaProgress) << 24) | searchBg);
                // Light border
                drawRoundedRectOutline(ctx, inX, inY, inW, inputH, 8, ((int)(0x10 * mediaProgress) << 24) | 0xFFFFFF);

                String searchText = MediaViewer.searchQuery;
                if (searchText.isEmpty()) {
                    ctx.drawTextWithShadow(font, "Search YouTube & Twitch...", inX + 8, inY + 4, ((int)(0x44 * mediaProgress) << 24) | 0x666666);
                } else {
                    int maxSW = inW - 20;
                    String display = searchText;
                    if (font.getWidth(display) > maxSW) {
                        display = "..." + searchText.substring(searchText.length() - 25);
                    }
                    ctx.drawTextWithShadow(font, display, inX + 8, inY + 4, (ma << 24) | 0xFFFFFF);
                    if (System.currentTimeMillis() % 1000 < 500) {
                        int cursorXp = inX + 8 + font.getWidth(display);
                        ctx.fill(cursorXp, inY + 3, cursorXp + 1, inY + 13, (ma << 24) | 0xFFFFFF);
                    }
                }

                // Results area
                int resultsTop = inY + inputH + 6;
                int resultsBottom = y + h - 22;

                if (MediaViewer.isSearching) {
                    String loadText = "Searching" + ".".repeat((int)(System.currentTimeMillis() / 400 % 4));
                    ctx.drawTextWithShadow(font, loadText,
                        x + w / 2 - font.getWidth(loadText) / 2,
                        resultsTop + 30,
                        (ma << 24) | 0x888888);
                } else if (MediaViewer.searchResults.isEmpty() && !MediaViewer.searchQuery.isEmpty()) {
                    ctx.drawTextWithShadow(font, "No results found",
                        x + w / 2 - font.getWidth("No results found") / 2,
                        resultsTop + 10,
                        ((int)(0x66 * mediaProgress) << 24) | 0x888888);
                } else if (MediaViewer.searchResults.isEmpty()) {
                    // Empty state — no hint text, just a clean search bar
                } else {
                    // Render paginated search results as cards
                    ctx.enableScissor(x + 2, resultsTop, x + w - 2, resultsBottom);
                    java.util.List<MediaViewer.SearchResult> pageResults = MediaViewer.getPageResults();
                    int thumbW = 48;
                    int thumbH = 27; // 16:9
                    int itemH = thumbH + 9;
                    int ry = resultsTop;

                    for (int ri = 0; ri < pageResults.size(); ri++) {
                        if (ry + itemH > resultsBottom + 10) break;
                        MediaViewer.SearchResult item = pageResults.get(ri);
                        int absIdx = MediaViewer.absoluteIndex(ri);

                        // Card background with hover
                        boolean cardHovered = mx >= x + 6 && mx < x + w - 6 && my >= ry && my < ry + itemH - 2;
                        if (cardHovered) {
                            drawRoundedRect(ctx, x + 6, ry, w - 12, itemH - 2, 6, ((int)(0x18 * mediaProgress) << 24) | 0xFFFFFF);
                            // Left accent bar on hover
                            int accentColor = "twitch".equals(item.source) ? 0x9146FF : 0xFF0000;
                            ctx.fill(x + 6, ry + 2, x + 8, ry + itemH - 4, (ma << 24) | accentColor);
                        }

                        // Click to select
                        if (hasClick && cx >= x + 6 && cx < x + w - 6 && cy >= ry && cy < ry + itemH - 2) {
                            MediaViewer.selectResult(absIdx);
                            hasClick = false;
                        }

                        // Thumbnail
                        int thumbX = x + 12;
                        int thumbY2 = ry + 3;
                        Identifier thumbId = ThumbnailCache.get(item.thumbnail);
                        if (thumbId != null) {
                            ctx.drawTexture(thumbId, thumbX, thumbY2, 0, 0, thumbW, thumbH, thumbW, thumbH);
                        } else {
                            // Gradient placeholder
                            int dotColor = "twitch".equals(item.source) ? 0x9146FF : 0xFF0000;
                            drawRoundedRect(ctx, thumbX, thumbY2, thumbW, thumbH, 3, ((int)(0x40 * mediaProgress) << 24) | 0x181820);
                            drawFilledCircle(ctx, thumbX + thumbW / 2, thumbY2 + thumbH / 2, 3, (ma << 24) | dotColor);
                        }

                        // Title
                        int textX = thumbX + thumbW + 6;
                        String itemTitle = item.title;
                        int maxTitleW = (x + w) - textX - 50;
                        if (font.getWidth(itemTitle) > maxTitleW) {
                            while (font.getWidth(itemTitle + "...") > maxTitleW && itemTitle.length() > 1)
                                itemTitle = itemTitle.substring(0, itemTitle.length() - 1);
                            itemTitle += "...";
                        }
                        int titleColor = cardHovered ? ((ma << 24) | 0xFFFFFF) : ((int)(0xCC * mediaProgress) << 24) | 0xDDDDDD;
                        ctx.drawTextWithShadow(font, itemTitle, textX, ry + 4, titleColor);

                        // Channel name
                        String meta = item.channel != null && !item.channel.isEmpty() ? item.channel : "";
                        if (font.getWidth(meta) > maxTitleW) {
                            meta = meta.substring(0, Math.min(meta.length(), 20)) + "...";
                        }
                        ctx.drawTextWithShadow(font, meta, textX, ry + 15, ((int)(0x55 * mediaProgress) << 24) | 0x888888);

                        // Duration badge
                        if (item.duration != null && !item.duration.isEmpty()) {
                            int badgeColor = "LIVE".equals(item.duration) ? 0xFF0000 : 0x333333;
                            String badge = item.duration;
                            int bw = font.getWidth(badge) + 6;
                            drawRoundedRect(ctx, x + w - bw - 10, ry + 5, bw, 10, 4, (ma << 24) | badgeColor);
                            ctx.drawTextWithShadow(font, badge, x + w - bw - 7, ry + 6, (ma << 24) | 0xFFFFFF);
                        }

                        ry += itemH;
                    }
                    ctx.disableScissor();

                    // Pagination footer
                    int totalPages = MediaViewer.getTotalPages();
                    if (totalPages > 1) {
                        int footY = y + h - 18;
                        String pageText = "Page " + (MediaViewer.searchPage + 1) + " of " + totalPages;
                        int ptw = font.getWidth(pageText);
                        ctx.drawTextWithShadow(font, pageText, x + w / 2 - ptw / 2, footY, ((int)(0x88 * mediaProgress) << 24) | 0xAAAAAA);

                        // Prev button
                        String prev = "<";
                        int prevX = x + w / 2 - ptw / 2 - 16;
                        boolean prevHover = mx >= prevX && mx < prevX + 10 && my >= footY - 1 && my < footY + 10;
                        boolean prevEnabled = MediaViewer.searchPage > 0;
                        int prevColor = prevEnabled ? (prevHover ? 0xFFFFFF : 0xAAAAAA) : 0x444444;
                        ctx.drawTextWithShadow(font, prev, prevX, footY, ((int)((prevEnabled ? 0xFF : 0x44) * mediaProgress) << 24) | prevColor);
                        if (hasClick && prevEnabled && cx >= prevX && cx < prevX + 10 && cy >= footY - 1 && cy < footY + 10) {
                            MediaViewer.prevPage();
                            hasClick = false;
                        }

                        // Next button
                        String next = ">";
                        int nextX = x + w / 2 + ptw / 2 + 8;
                        boolean nextHover = mx >= nextX && mx < nextX + 10 && my >= footY - 1 && my < footY + 10;
                        boolean nextEnabled = MediaViewer.searchPage < totalPages - 1;
                        int nextColor = nextEnabled ? (nextHover ? 0xFFFFFF : 0xAAAAAA) : 0x444444;
                        ctx.drawTextWithShadow(font, next, nextX, footY, ((int)((nextEnabled ? 0xFF : 0x44) * mediaProgress) << 24) | nextColor);
                        if (hasClick && nextEnabled && cx >= nextX && cx < nextX + 10 && cy >= footY - 1 && cy < footY + 10) {
                            MediaViewer.nextPage();
                            hasClick = false;
                        }
                    }
                }

            } else {
                // ══ PLAYER VIEW — Clickable Controls ══
                boolean isTwitch = MediaViewer.mediaType == MediaViewer.MediaType.TWITCH;
                boolean isYoutube = MediaViewer.mediaType == MediaViewer.MediaType.YOUTUBE;
                int headerColor = isTwitch ? 0x9146FF : isYoutube ? 0xFF0000 : 0xCCCCCC;

                int headerY = y + 6;

                // Back button (clickable)
                String backBtn = "< Back";
                int backW = font.getWidth(backBtn) + 8;
                boolean backHover = mx >= x + 6 && mx < x + 6 + backW && my >= headerY - 1 && my < headerY + 11;
                int backBg = backHover ? 0x30 : 0x15;
                drawRoundedRect(ctx, x + 6, headerY - 1, backW, 12, 6, ((int)(backBg * mediaProgress) << 24) | 0xFFFFFF);
                ctx.drawTextWithShadow(font, backBtn, x + 10, headerY + 1, ((int)((backHover ? 0xFF : 0x99) * mediaProgress) << 24) | 0xCCCCCC);
                if (hasClick && cx >= x + 6 && cx < x + 6 + backW && cy >= headerY - 1 && cy < headerY + 11) {
                    MediaViewer.stopStream();
                    DynamicIslandMod.isMediaOpen = true;
                    MediaViewer.activeTab = "SEARCH";
                    hasClick = false;
                }

                // Source badge
                String sourceLabel = isTwitch ? "TWITCH" : isYoutube ? "YOUTUBE" : "MEDIA";
                int slW = font.getWidth(sourceLabel) + 8;
                drawRoundedRect(ctx, x + 6 + backW + 4, headerY - 1, slW, 12, 6, (ma << 24) | headerColor);
                ctx.drawTextWithShadow(font, sourceLabel, x + 6 + backW + 8, headerY + 1, (ma << 24) | 0xFFFFFF);

                // Title
                String title = MediaViewer.currentTitle.isEmpty() ? MediaViewer.currentSource : MediaViewer.currentTitle;
                int titleStartX = x + 6 + backW + 4 + slW + 6;
                int titleMaxW2 = (x + w - 8) - titleStartX;
                if (font.getWidth(title) > titleMaxW2) {
                    while (font.getWidth(title + "...") > titleMaxW2 && title.length() > 1)
                        title = title.substring(0, title.length() - 1);
                    title += "...";
                }
                ctx.drawTextWithShadow(font, title, titleStartX, headerY + 1, (ma << 24) | 0xFFFFFF);

                // Video area
                int videoTop = headerY + 16;
                int videoW = w - 20;
                int videoH = (int)(videoW * 9f / 16f);
                int videoX = x + 10;

                MediaViewer.preRender();

                if (MediaViewer.hasTexture() && MediaViewer.getTextureIdentifier() != null) {
                    ctx.drawTexture(MediaViewer.getTextureIdentifier(), videoX, videoTop, 0, 0, videoW, videoH, videoW, videoH);
                } else {
                    drawRoundedRect(ctx, videoX, videoTop, videoW, videoH, 4, (ma << 24) | 0x111111);
                    String placeholder = MediaViewer.watermediaAvailable ? "Loading stream..." : "Install WATERMeDIA mod";
                    ctx.drawTextWithShadow(font, placeholder,
                        videoX + videoW / 2 - font.getWidth(placeholder) / 2,
                        videoTop + videoH / 2 - 4,
                        ((int)(0x88 * mediaProgress) << 24) | 0x888888);
                }

                if (isYoutube) {
                    long pos = MediaViewer.getPosition();
                    long dur = MediaViewer.getDuration();
                    boolean playing = MediaViewer.isPlaying();

                    // Progress bar (clickable + scrubbable)
                    int barY = videoTop + videoH + 4;
                    int barX2 = x + 10;
                    int barW = w - 20;
                    int barH = 4;

                    // Bar track
                    drawRoundedRect(ctx, barX2, barY, barW, barH, 2, ((int)(0x30 * mediaProgress) << 24) | 0xFFFFFF);
                    // Filled portion
                    if (dur > 0) {
                        int filled = (int)(barW * pos / (float) dur);
                        if (filled > 0) drawRoundedRect(ctx, barX2, barY, filled, barH, 2, (ma << 24) | 0xFF0000);
                        // Scrub dot
                        drawFilledCircle(ctx, barX2 + filled, barY + 2, 3, (ma << 24) | 0xFFFFFF);
                    }

                    // Progress bar click to seek (strict Y bounds: only within bar ± 3px)
                    if (hasClick && cx >= barX2 && cx < barX2 + barW && cy >= barY - 3 && cy < barY + barH + 3 && dur > 0) {
                        float ratio = (float)(cx - barX2) / barW;
                        ratio = Math.max(0, Math.min(1, ratio));
                        MediaViewer.seekTo((long)(ratio * dur));
                        hasClick = false;
                    }
                    // Drag scrubbing (strict Y bounds)
                    if (TwitchScreen.isDragging && TwitchScreen.dragX >= barX2 && TwitchScreen.dragX < barX2 + barW
                        && TwitchScreen.dragY >= barY - 3 && TwitchScreen.dragY < barY + barH + 3 && dur > 0) {
                        float ratio = (float)(TwitchScreen.dragX - barX2) / barW;
                        ratio = Math.max(0, Math.min(1, ratio));
                        MediaViewer.seekTo((long)(ratio * dur));
                    }

                    // Time display (row 1 — under progress bar)
                    int timeY = barY + barH + 3;
                    String timeStr = formatMs(pos) + " / " + formatMs(dur);
                    ctx.drawTextWithShadow(font, timeStr, x + 10, timeY, ((int)(0x88 * mediaProgress) << 24) | 0xAAAAAA);

                    // Control buttons row (row 2 — under time)
                    int ctrlY = timeY + 12;
                    int btnH = 14;
                    int btnSpacing = 4;

                    // << 5s button
                    String rewBtn = "<< 5s";
                    int rewW = font.getWidth(rewBtn) + 10;
                    int rewX = x + 10;
                    boolean rewHover = mx >= rewX && mx < rewX + rewW && my >= ctrlY && my < ctrlY + btnH;
                    drawRoundedRect(ctx, rewX, ctrlY, rewW, btnH, 6, ((int)((rewHover ? 0x30 : 0x18) * mediaProgress) << 24) | 0xFFFFFF);
                    ctx.drawTextWithShadow(font, rewBtn, rewX + 5, ctrlY + 3, ((int)((rewHover ? 0xFF : 0xAA) * mediaProgress) << 24) | 0xCCCCCC);
                    if (hasClick && cx >= rewX && cx < rewX + rewW && cy >= ctrlY && cy < ctrlY + btnH) {
                        MediaViewer.seek(-5000);
                        hasClick = false;
                    }

                    // Play/Pause button
                    String playBtn = playing ? " || " : "  >  ";
                    int playW = font.getWidth(playBtn) + 10;
                    int playX = rewX + rewW + btnSpacing;
                    boolean playHover = mx >= playX && mx < playX + playW && my >= ctrlY && my < ctrlY + btnH;
                    drawRoundedRect(ctx, playX, ctrlY, playW, btnH, 6, ((int)((playHover ? 0x40 : 0x25) * mediaProgress) << 24) | 0xFFFFFF);
                    ctx.drawTextWithShadow(font, playBtn, playX + 5, ctrlY + 3, (ma << 24) | 0xFFFFFF);
                    if (hasClick && cx >= playX && cx < playX + playW && cy >= ctrlY && cy < ctrlY + btnH) {
                        MediaViewer.togglePause();
                        hasClick = false;
                    }

                    // >> 5s button
                    String fwdBtn = "5s >>";
                    int fwdW = font.getWidth(fwdBtn) + 10;
                    int fwdX = playX + playW + btnSpacing;
                    boolean fwdHover = mx >= fwdX && mx < fwdX + fwdW && my >= ctrlY && my < ctrlY + btnH;
                    drawRoundedRect(ctx, fwdX, ctrlY, fwdW, btnH, 6, ((int)((fwdHover ? 0x30 : 0x18) * mediaProgress) << 24) | 0xFFFFFF);
                    ctx.drawTextWithShadow(font, fwdBtn, fwdX + 5, ctrlY + 3, ((int)((fwdHover ? 0xFF : 0xAA) * mediaProgress) << 24) | 0xCCCCCC);
                    if (hasClick && cx >= fwdX && cx < fwdX + fwdW && cy >= ctrlY && cy < ctrlY + btnH) {
                        MediaViewer.seek(5000);
                        hasClick = false;
                    }

                    // Volume (right side of control row)
                    String volIcon = MediaViewer.isMuted() ? "Mx" : "Vol";
                    int volLabelW = font.getWidth(volIcon);
                    int vBarW = 40;
                    int totalVolW = volLabelW + 4 + vBarW;
                    int volX = x + w - totalVolW - 10;
                    boolean volIconHover = mx >= volX && mx < volX + volLabelW + 4 && my >= ctrlY && my < ctrlY + btnH;
                    ctx.drawTextWithShadow(font, volIcon, volX, ctrlY + 3, ((int)((volIconHover ? 0xFF : 0x88) * mediaProgress) << 24) | 0xAAAAAA);
                    if (hasClick && cx >= volX && cx < volX + volLabelW + 4 && cy >= ctrlY && cy < ctrlY + btnH) {
                        MediaViewer.toggleMute();
                        hasClick = false;
                    }

                    // Volume bar (inline with volume label)
                    int vBarX = volX + volLabelW + 4;
                    int vBarY = ctrlY + 5;
                    drawRoundedRect(ctx, vBarX, vBarY, vBarW, 4, 2, ((int)(0x30 * mediaProgress) << 24) | 0xFFFFFF);
                    int volFilled = (int)(vBarW * MediaViewer.getVolume() / 100f);
                    if (volFilled > 0) drawRoundedRect(ctx, vBarX, vBarY, volFilled, 4, 2, (ma << 24) | 0xFFFFFF);
                    // Volume bar click
                    if (hasClick && cx >= vBarX && cx < vBarX + vBarW && cy >= vBarY - 4 && cy < vBarY + 8) {
                        int newVol = (int)(100f * (cx - vBarX) / vBarW);
                        MediaViewer.setVolume(Math.max(0, Math.min(100, newVol)));
                        hasClick = false;
                    }

                } else if (isTwitch) {
                    // Twitch chat area (below video)
                    int chatSepY = videoTop + videoH + 4;
                    ctx.fill(x + 8, chatSepY, x + w - 8, chatSepY + 1, ((int)(0x15 * mediaProgress) << 24) | 0xFFFFFF);

                    int chatTop = chatSepY + 3;
                    int inputH2 = 18;
                    int chatBottom = y + h - inputH2 - 6;

                    ctx.enableScissor(x + 2, chatTop, x + w - 2, chatBottom);
                    java.util.List<TwitchChat.ChatMsg> msgs = TwitchChat.messages;
                    int lineH = 10;
                    int my2 = chatBottom - 2;

                    for (int idx = 0; idx < msgs.size() && my2 > chatTop - lineH; idx++) {
                        TwitchChat.ChatMsg msg = msgs.get(idx);
                        int msgColor;
                        try {
                            msgColor = (ma << 24) | Integer.parseInt(msg.color.replace("#", ""), 16);
                        } catch (Exception e) {
                            msgColor = (ma << 24) | 0xFFFFFF;
                        }

                        String prefix = msg.username + ": ";
                        String fullMsg = prefix + msg.message;
                        int maxMsgW = w - 24;
                        if (font.getWidth(fullMsg) > maxMsgW) {
                            while (font.getWidth(fullMsg + "...") > maxMsgW && fullMsg.length() > prefix.length())
                                fullMsg = fullMsg.substring(0, fullMsg.length() - 1);
                            fullMsg += "...";
                        }

                        my2 -= lineH;
                        ctx.drawTextWithShadow(font, prefix, x + 10, my2, msgColor);
                        String msgText = msg.message;
                        int maxBodyLen = fullMsg.length() - prefix.length();
                        if (maxBodyLen < msgText.length()) msgText = msgText.substring(0, Math.max(0, maxBodyLen));
                        ctx.drawTextWithShadow(font, msgText,
                            x + 10 + font.getWidth(prefix), my2, (ma << 24) | 0xDDDDDD);
                    }
                    ctx.disableScissor();

                    int inY3 = y + h - inputH2 - 3;
                    int inX3 = x + 8;
                    int inW3 = w - 16;
                    drawRoundedRect(ctx, inX3, inY3, inW3, inputH2, 9, ((int)(0xDD * mediaProgress) << 24) | 0x2A2A2A);

                    String inputText = TwitchChat.inputText;
                    if (inputText.isEmpty()) {
                        ctx.drawTextWithShadow(font, "Type a message...", inX3 + 8, inY3 + 5, ((int)(0x44 * mediaProgress) << 24) | 0x666666);
                    } else {
                        int maxInputW = inW3 - 20;
                        String display = inputText;
                        if (font.getWidth(display) > maxInputW) {
                            display = "..." + inputText.substring(inputText.length() - 20);
                        }
                        ctx.drawTextWithShadow(font, display, inX3 + 8, inY3 + 5, (ma << 24) | 0xFFFFFF);
                        if (System.currentTimeMillis() % 1000 < 500) {
                            int cursorX2 = inX3 + 8 + font.getWidth(display);
                            ctx.fill(cursorX2, inY3 + 4, cursorX2 + 1, inY3 + 14, (ma << 24) | 0xFFFFFF);
                        }
                    }
                }
            }

            // Consume click
            TwitchScreen.clickPending = false;
            } // end of else (original media viewer)
        }

        // ════════════════════════════════════════════════
        // APP DRAWER (Control Center)
        // ════════════════════════════════════════════════
        if (isAppDrawerOpen && appDrawerProgress > 0.01f) {
            int da = (int)(0xFF * appDrawerProgress);

            // 3x2 grid of app tiles
            String[] appNames = {"Media", "Loomie", "Notifs", "Waypoints", "Timers", "Settings"};
            int[] appColors = {0xFF0000, 0x66FCF1, 0xFFB800, 0x4CAF50, 0xAB47BC, 0x78909C};
            // Text-based pixel icons
            String[] appIcons = {">", "?", "!", "@", "~", "*"};

            int cols = 3;
            int tileW = 60;
            int tileH = 54;
            int gapX = 8;
            int gapY = 6;
            int gridW = cols * tileW + (cols - 1) * gapX;
            int gridX = x + (w - gridW) / 2;
            int gridY = y + 12;

            int amx = mouseX, amy = mouseY;
            boolean dClick = AppDrawerScreen.clickPending;
            int dcx = AppDrawerScreen.clickX, dcy = AppDrawerScreen.clickY;

            for (int i = 0; i < appNames.length; i++) {
                int col = i % cols;
                int row = i / cols;
                int tx = gridX + col * (tileW + gapX);
                int ty = gridY + row * (tileH + gapY);

                boolean hover = amx >= tx && amx < tx + tileW && amy >= ty && amy < ty + tileH;
                int tileBg = hover ? 0x20 : 0x10;
                drawRoundedRect(ctx, tx, ty, tileW, tileH, 8, ((int)(tileBg * appDrawerProgress) << 24) | 0xFFFFFF);
                // Tile border
                if (hover) {
                    drawRoundedRectOutline(ctx, tx, ty, tileW, tileH, 8, ((int)(0x20 * appDrawerProgress) << 24) | appColors[i]);
                }

                // Icon text symbol
                String icon = appIcons[i];
                int iconW = font.getWidth(icon);
                ctx.drawTextWithShadow(font, icon, tx + (tileW - iconW) / 2, ty + 14, (da << 24) | appColors[i]);

                // Label
                int labelW = font.getWidth(appNames[i]);
                ctx.drawTextWithShadow(font, appNames[i], tx + (tileW - labelW) / 2, ty + tileH - 14, ((int)((hover ? 0xFF : 0xAA) * appDrawerProgress) << 24) | 0xDDDDDD);

                // Tile click handling
                if (dClick && dcx >= tx && dcx < tx + tileW && dcy >= ty && dcy < ty + tileH) {
                    // Close drawer first
                    isAppDrawerOpen = false;
                    DynamicIslandMod.isAppDrawerOpen = false;
                    if (client.currentScreen instanceof AppDrawerScreen) {
                        client.currentScreen.close();
                    }

                    // Open the corresponding panel
                    switch (i) {
                        case 0: // Media — opens in-game YouTube/Twitch browser
                            DynamicIslandMod.isMediaOpen = true;
                            InGameBrowser.openMedia();
                            break;
                        case 1: // Loomie AI
                            DynamicIslandMod.isPebbleOpen = true;
                            client.setScreen(new PebbleScreen());
                            break;
                        case 2: // Notifications
                            DynamicIslandMod.notifCenterTab = 0;
                            DynamicIslandMod.isNotifCenterOpen = true;
                            client.setScreen(new NotifCenterScreen());
                            break;
                        case 3: // Waypoints
                            DynamicIslandMod.notifCenterTab = 1;
                            DynamicIslandMod.isNotifCenterOpen = true;
                            client.setScreen(new NotifCenterScreen());
                            break;
                        case 4: // Timers
                            DynamicIslandMod.notifCenterTab = 2;
                            DynamicIslandMod.isNotifCenterOpen = true;
                            client.setScreen(new NotifCenterScreen());
                            break;
                        case 5: // Settings
                            DynamicIslandMod.isSettingsOpen = true;
                            client.setScreen(new SettingsScreen());
                            break;
                    }
                    dClick = false;
                }
            }

            AppDrawerScreen.clickPending = false;
        }

        // ══════════════════════════════════════════════
        // BOSS BARS (below the pill)
        // ══════════════════════════════════════════════
        if (!BossBarTracker.activeBars.isEmpty()) {
            int bossY = y + h + 4;
            for (BossBarTracker.BossBarInfo bar : BossBarTracker.activeBars) {
                int barW = Math.max(w, 160);
                int barX = screenW / 2 - barW / 2;

                ctx.drawTextWithShadow(font, bar.name, screenW / 2 - font.getWidth(bar.name) / 2, bossY, 0xFFFFFF);
                bossY += 10;

                drawRoundedRect(ctx, barX, bossY, barW, 5, 2, 0xCC000000);
                int fillW = (int)(barW * bar.percent);
                if (fillW > 0) drawRoundedRect(ctx, barX, bossY, fillW, 5, 2, bar.getBarColor());
                bossY += 10;
            }
        }
    }

    // ══════════════════════════════════════════════════
    // DRAWING HELPERS
    // ══════════════════════════════════════════════════

    private void drawCircleMask(DrawContext ctx, int x, int y, int size, int bgColor) {
        int r = size / 2;
        int cx = x + r;
        for (int row = 0; row < size; row++) {
            int dy = r - row;
            int dx = (int) Math.round(Math.sqrt(Math.max(0, (double) r * r - (double) dy * dy)));
            int leftEdge = cx - dx;
            int rightEdge = cx + dx;
            if (leftEdge > x) ctx.fill(x, y + row, leftEdge, y + row + 1, bgColor);
            if (rightEdge < x + size) ctx.fill(rightEdge, y + row, x + size, y + row + 1, bgColor);
        }
    }

    private void drawFilledCircle(DrawContext ctx, int x, int y, int size, int color) {
        int r = size / 2;
        int cx = x + r;
        for (int row = 0; row < size; row++) {
            int dy = r - row;
            int dx = (int) Math.round(Math.sqrt(Math.max(0, (double) r * r - (double) dy * dy)));
            ctx.fill(cx - dx, y + row, cx + dx, y + row + 1, color);
        }
    }

    /**
     * Draws an item at the given position, scaled to itemSize, with a durability bar underneath.
     */
    private void drawCombatItem(DrawContext ctx, ItemStack stack, int ix, int iy, int itemSize) {
        if (stack != null && !stack.isEmpty()) {
            ctx.getMatrices().push();
            float scale = itemSize / 16f;
            ctx.getMatrices().translate(ix, iy, 0);
            ctx.getMatrices().scale(scale, scale, 1.0f);
            ctx.drawItem(stack, 0, 0);
            ctx.getMatrices().pop();

            // Durability bar
            if (stack.isDamageable() && stack.getDamage() > 0) {
                float durPct = 1.0f - (float)stack.getDamage() / stack.getMaxDamage();
                int durColor = durPct > 0.5f ? 0xFF44DD44 : durPct > 0.25f ? 0xFFDDDD44 : 0xFFDD4444;
                int durW = Math.max(1, (int)(itemSize * durPct));
                ctx.fill(ix, iy + itemSize + 1, ix + itemSize, iy + itemSize + 3, 0xFF222222);
                ctx.fill(ix, iy + itemSize + 1, ix + durW, iy + itemSize + 3, durColor);
            } else if (stack.isDamageable()) {
                ctx.fill(ix, iy + itemSize + 1, ix + itemSize, iy + itemSize + 3, 0xFF44DD44);
            }
        } else {
            drawRoundedRect(ctx, ix, iy, itemSize, itemSize, 2, 0x20FFFFFF);
        }
    }

    public static void drawRoundedRect(DrawContext ctx, int x, int y, int w, int h, int r, int color) {
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

    public static void drawRoundedRectOutline(DrawContext ctx, int x, int y, int w, int h, int r, int color) {
        if (r <= 0) {
            ctx.fill(x, y, x + w, y + 1, color); // top
            ctx.fill(x, y + h - 1, x + w, y + h, color); // bottom
            ctx.fill(x, y, x + 1, y + h, color); // left
            ctx.fill(x + w - 1, y, x + w, y + h, color); // right
            return;
        }
        r = Math.min(r, Math.min(w / 2, h / 2));
        // Top edge
        ctx.fill(x + r, y, x + w - r, y + 1, color);
        // Bottom edge
        ctx.fill(x + r, y + h - 1, x + w - r, y + h, color);
        // Left edge
        ctx.fill(x, y + r, x + 1, y + h - r, color);
        // Right edge
        ctx.fill(x + w - 1, y + r, x + w, y + h - r, color);
        // Corner arcs (1px outline)
        for (int row = 0; row < r; row++) {
            int dy = r - row;
            int dx = (int) Math.round(r - Math.sqrt((double) r * r - (double) dy * dy));
            int dx2 = (int) Math.round(r - Math.sqrt((double) r * r - (double) (dy - 1) * (dy - 1)));
            // Top-left
            ctx.fill(x + dx, y + row, x + Math.max(dx + 1, dx2), y + row + 1, color);
            // Top-right
            ctx.fill(x + w - Math.max(dx + 1, dx2), y + row, x + w - dx, y + row + 1, color);
            // Bottom-left
            ctx.fill(x + dx, y + h - 1 - row, x + Math.max(dx + 1, dx2), y + h - row, color);
            // Bottom-right
            ctx.fill(x + w - Math.max(dx + 1, dx2), y + h - 1 - row, x + w - dx, y + h - row, color);
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

                    // Extract dominant color
                    long totalR = 0, totalG = 0, totalB = 0;
                    int samples = 0;
                    int step = Math.max(1, Math.min(imgW, imgH) / 20);
                    for (int sy = 0; sy < imgH; sy += step) {
                        for (int sx = 0; sx < imgW; sx += step) {
                            int argb = buffered.getRGB(sx, sy);
                            totalR += (argb >> 16) & 0xFF;
                            totalG += (argb >> 8) & 0xFF;
                            totalB += argb & 0xFF;
                            samples++;
                        }
                    }
                    if (samples > 0) {
                        int avgR = Math.max(5, Math.min(40, (int)(totalR / samples * 0.15f)));
                        int avgG = Math.max(5, Math.min(40, (int)(totalG / samples * 0.15f)));
                        int avgB = Math.max(5, Math.min(40, (int)(totalB / samples * 0.15f)));
                        albumTintColor = (avgR << 16) | (avgG << 8) | avgB;
                    }

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
                            albumTextureId = Identifier.of("cobble", "album_art");
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

    // ══════════════════════════════════════════════════
    // PEBBLE HELPERS
    // ══════════════════════════════════════════════════

    private int pebbleBubbleH(TextRenderer f, String text, int maxW) {
        return pebbleWrap(f, text, maxW - 14).size() * 10 + 10;
    }

    private java.util.List<String> pebbleWrap(TextRenderer f, String text, int maxW) {
        java.util.List<String> lines = new java.util.ArrayList<>();
        if (text == null || text.isEmpty()) { lines.add(""); return lines; }
        for (String para : text.split("\n")) {
            if (para.trim().isEmpty()) continue;
            StringBuilder cur = new StringBuilder();
            for (String w : para.split(" ")) {
                if (w.isEmpty()) continue;
                if (f.getWidth(w) > maxW) {
                    if (cur.length() > 0) { lines.add(cur.toString()); cur = new StringBuilder(); }
                    StringBuilder part = new StringBuilder();
                    for (char c : w.toCharArray()) {
                        if (f.getWidth(part.toString() + c) > maxW) { lines.add(part.toString()); part = new StringBuilder(); }
                        part.append(c);
                    }
                    if (part.length() > 0) cur = part;
                    continue;
                }
                String test = cur.length() > 0 ? cur + " " + w : w;
                if (f.getWidth(test) > maxW) { lines.add(cur.toString()); cur = new StringBuilder(w); }
                else { if (cur.length() > 0) cur.append(" "); cur.append(w); }
            }
            if (cur.length() > 0) lines.add(cur.toString());
        }
        if (lines.isEmpty()) lines.add("");
        return lines;
    }

    // ══════════════════════════════════════════════════
    // NOTIFICATION / SETTINGS HELPERS
    // ══════════════════════════════════════════════════

    private String relativeTime(long deltaMs) {
        long sec = deltaMs / 1000;
        if (sec < 5) return "now";
        if (sec < 60) return sec + "s";
        long min = sec / 60;
        if (min < 60) return min + "m";
        long hr = min / 60;
        return hr + "h";
    }

    private boolean getToggle(String name) {
        return switch (name) {
            case "toggleLowHealth" -> DynamicIslandMod.toggleLowHealth;
            case "toggleLowHunger" -> DynamicIslandMod.toggleLowHunger;
            case "toggleDurability" -> DynamicIslandMod.toggleDurability;
            case "togglePlayerNearby" -> DynamicIslandMod.togglePlayerNearby;
            case "toggleWhisper" -> DynamicIslandMod.toggleWhisper;
            case "toggleBiome" -> DynamicIslandMod.toggleBiome;
            case "toggleInventoryFull" -> DynamicIslandMod.toggleInventoryFull;
            default -> true;
        };
    }

    private void setToggle(String name, boolean val) {
        switch (name) {
            case "toggleLowHealth" -> DynamicIslandMod.toggleLowHealth = val;
            case "toggleLowHunger" -> DynamicIslandMod.toggleLowHunger = val;
            case "toggleDurability" -> DynamicIslandMod.toggleDurability = val;
            case "togglePlayerNearby" -> DynamicIslandMod.togglePlayerNearby = val;
            case "toggleWhisper" -> DynamicIslandMod.toggleWhisper = val;
            case "toggleBiome" -> DynamicIslandMod.toggleBiome = val;
            case "toggleInventoryFull" -> DynamicIslandMod.toggleInventoryFull = val;
        }
        DynamicIslandConfig.save();
    }

    private void saveInventoryLayout() {
        net.minecraft.client.MinecraftClient client = net.minecraft.client.MinecraftClient.getInstance();
        if (client.player == null) return;
        int[] layout = new int[36]; // main inventory slots
        for (int i = 0; i < 36; i++) {
            net.minecraft.item.ItemStack stack = client.player.getInventory().main.get(i);
            layout[i] = stack.isEmpty() ? -1 : net.minecraft.registry.Registries.ITEM.getRawId(stack.getItem());
        }
        DynamicIslandMod.savedInventoryLayout = layout;
        DynamicIslandMod.hasInventoryPreset = true;
    }
}
