package com.cobble.dynamicisland;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.message.v1.ClientReceiveMessageEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import net.minecraft.sound.SoundEvents;
import org.lwjgl.glfw.GLFW;

import java.util.ArrayList;
import java.util.List;

public class DynamicIslandMod implements ClientModInitializer {
    public static LauncherState currentState = null;
    public static boolean isAppDrawerOpen = false;
    public static String currentNotification = null;
    private static long notificationStartTime = 0;
    private static long notificationEndTime = 0;
    private static KeyBinding expandKeyBinding;
    private static KeyBinding appDrawerKeyBinding;
    private static KeyBinding pauseKeyBinding;
    private static KeyBinding prevKeyBinding;
    private static KeyBinding nextKeyBinding;
    private static KeyBinding lyricsKeyBinding;
    private static KeyBinding networkStatsKeyBinding;
    public static boolean isExpanded = false;
    public static boolean isLyricsMode = false;
    public static boolean privacyMode = false;
    private static long volumeRestoreTime = 0;
    private static String lastPersistentType = null;
    private static KeyBinding privacyKeyBinding;

    // ── Pebble Chat (shared state) ────────────────
    public static boolean isPebbleOpen = false;
    public static final List<PebbleChatMsg> pebbleMessages = new ArrayList<>();
    public static boolean pebbleWaiting = false;
    public static String pebbleInputText = "";
    public static int pebbleScroll = 0;
    public static int pebbleTypingDots = 0;
    public static long pebbleLastDotTime = 0;

    // ── Notification Center ───────────────────
    public static boolean isNotifCenterOpen = false;
    public static final List<NotifEntry> notifHistory = new ArrayList<>();
    public static int notifCenterScroll = 0;
    private static final int MAX_NOTIF_HISTORY = 20;
    public static int notifCenterTab = 0; // 0=Notifications, 1=Waypoints, 2=Timers
    public static int notifClickX = 0;
    public static int notifClickY = 0;
    public static boolean notifClickPending = false;
    public static int notifClickButton = 0; // 0=left, 1=right

    // ── Displayed coordinates (for copy/share) ──
    public static String displayedCoords = null; // "X Y Z" when coords visible

    // ── Settings Panel ────────────────────────
    public static boolean isSettingsOpen = false;
    public static int settingsTab = 0; // 0=Keybinds, 1=Notifications, 2=Inventory, 3=Themes
    public static int settingsScroll = 0;

    // ── Media Viewer Panel ────────────────────
    public static boolean isMediaOpen = false;
    public static float mediaProgress = 0f;

    // Notification toggles
    public static boolean toggleLowHealth = true;
    public static boolean toggleLowHunger = true;
    public static boolean toggleDurability = true;
    public static boolean togglePlayerNearby = true;
    public static boolean toggleWhisper = true;
    public static boolean toggleBiome = true;
    public static boolean toggleInventoryFull = true;

    // Settings click handling
    public static int settingsClickX = 0;
    public static int settingsClickY = 0;
    public static boolean settingsClickPending = false;

    // Inventory preset
    public static int[] savedInventoryLayout = null; // slot -> item raw id mapping
    public static boolean hasInventoryPreset = false;

    public static class NotifEntry {
        public final String text;
        public final String type; // "whisper", "health", "hunger", "durability", "player", "inventory", "death", "general"
        public final long timestamp;
        public NotifEntry(String text, String type) {
            this.text = text;
            this.type = type;
            this.timestamp = System.currentTimeMillis();
        }
    }

    public static void recordNotification(String text, String type) {
        notifHistory.add(0, new NotifEntry(text, type));
        while (notifHistory.size() > MAX_NOTIF_HISTORY) {
            notifHistory.remove(notifHistory.size() - 1);
        }
    }

    public static class PebbleChatMsg {
        public final String text;
        public final boolean isUser;
        public PebbleChatMsg(String text, boolean isUser) {
            this.text = text;
            this.isUser = isUser;
        }
    }

    public static void addPebbleAnswer(String ans) {
        pebbleWaiting = false;
        // Strip markdown
        ans = ans.replace("**", "").replace("__", "").replace("`", "");
        ans = ans.replaceAll("(?m)^#{1,6}\\s*", "");
        ans = ans.replaceAll("(?m)^[\\-*]\\s+", "• ");
        ans = ans.replaceAll("\\n{2,}", "\n");
        ans = ans.replace("\\n", "\n").trim();
        pebbleMessages.add(new PebbleChatMsg(ans, false));
        pebbleScroll = 0;
    }

    @Override
    public void onInitializeClient() {
        System.out.println("[DynamicIsland] Starting up...");
        DynamicIslandConfig.load();
        DynamicIslandConfig.apply();
        LauncherWebSocket.connectToServer();
        MediaViewer.init();
        InGameBrowser.preWarmMcef(); // Pre-warm MCEF for fast first browser open

        // ── Loom Shield Protection System ──
        com.cobble.dynamicisland.protection.LoomShield.init();
        com.cobble.dynamicisland.protection.ChatSafety.init();

        HudRenderCallback.EVENT.register(new DynamicIslandHud());

        // Register game alert system
        GameAlerts.register();

        // Register inventory gesture system
        GestureHandler.register();

        // Register new systems
        TimerManager.register();
        WaypointManager.register();
        CombatTracker.register();

        // Track server connections for Loom Shield
        ClientPlayConnectionEvents.JOIN.register((handler, sender, client) -> {
            String serverIp = "";
            if (client.getCurrentServerEntry() != null) {
                serverIp = client.getCurrentServerEntry().address;
            }
            com.cobble.dynamicisland.protection.LoomShield.onServerJoin(serverIp);
        });

        // Clear world-specific state on disconnect (switching servers/worlds)
        ClientPlayConnectionEvents.DISCONNECT.register((handler, client) -> {
            com.cobble.dynamicisland.protection.LoomShield.onServerDisconnect();
            GameAlerts.clearPersistent();
            WaypointManager.cancelNavigation();
            CombatTracker.endCombat();
            TimerManager.dismissFinishedTimer();
            NetworkStats.reset();
            MediaViewer.cleanup();
            TwitchChat.clear();
            isMediaOpen = false;
            currentNotification = null;
            notificationEndTime = 0;
            System.out.println("[DynamicIsland] World state cleared on disconnect");
        });

        // Whisper/DM detection — listen to both GAME and CHAT events
        ClientReceiveMessageEvents.GAME.register((message, overlay) -> {
            handleWhisperMessage(message.getString());
        });
        ClientReceiveMessageEvents.CHAT.register((message, signedMessage, sender, params, receptionTimestamp) -> {
            handleWhisperMessage(message.getString());
        });

        // Press X to open App Drawer
        appDrawerKeyBinding = KeyBindingHelper.registerKeyBinding(new KeyBinding(
            "App Drawer",
            InputUtil.Type.KEYSYM,
            GLFW.GLFW_KEY_X,
            "Dynamic Island"
        ));

        // Press M to expand/collapse music controls
        expandKeyBinding = KeyBindingHelper.registerKeyBinding(new KeyBinding(
            "Expand Island", 
            InputUtil.Type.KEYSYM,
            GLFW.GLFW_KEY_M,
            "Dynamic Island"
        ));

        // Music controls
        pauseKeyBinding = KeyBindingHelper.registerKeyBinding(new KeyBinding(
            "Play/Pause Music",
            InputUtil.Type.KEYSYM,
            GLFW.GLFW_KEY_GRAVE_ACCENT,
            "Dynamic Island"
        ));

        prevKeyBinding = KeyBindingHelper.registerKeyBinding(new KeyBinding(
            "Previous Track",
            InputUtil.Type.KEYSYM,
            GLFW.GLFW_KEY_LEFT_BRACKET,
            "Dynamic Island"
        ));

        nextKeyBinding = KeyBindingHelper.registerKeyBinding(new KeyBinding(
            "Next Track",
            InputUtil.Type.KEYSYM,
            GLFW.GLFW_KEY_RIGHT_BRACKET,
            "Dynamic Island"
        ));

        lyricsKeyBinding = KeyBindingHelper.registerKeyBinding(new KeyBinding(
            "Toggle Lyrics",
            InputUtil.Type.KEYSYM,
            GLFW.GLFW_KEY_K,
            "Dynamic Island"
        ));

        // Press P to toggle Privacy Mode
        privacyKeyBinding = KeyBindingHelper.registerKeyBinding(new KeyBinding(
            "Privacy Mode",
            InputUtil.Type.KEYSYM,
            GLFW.GLFW_KEY_P,
            "Dynamic Island"
        ));


        // Press F7 to show network stats (ping + TPS)
        networkStatsKeyBinding = KeyBindingHelper.registerKeyBinding(new KeyBinding(
            "Network Stats",
            InputUtil.Type.KEYSYM,
            GLFW.GLFW_KEY_F7,
            "Dynamic Island"
        ));

        // Press T to open media viewer panel (ESC to close)
        KeyBinding mediaKeyBinding = KeyBindingHelper.registerKeyBinding(new KeyBinding(
            "Media Viewer",
            InputUtil.Type.KEYSYM,
            GLFW.GLFW_KEY_T,
            "Dynamic Island"
        ));

        // Press L to open Loomie AI chat
        KeyBinding loomieKeyBinding = KeyBindingHelper.registerKeyBinding(new KeyBinding(
            "Loomie AI",
            InputUtil.Type.KEYSYM,
            GLFW.GLFW_KEY_L,
            "Dynamic Island"
        ));

        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            while (appDrawerKeyBinding.wasPressed()) {
                if (isAppDrawerOpen) {
                    // Close App Drawer
                    isAppDrawerOpen = false;
                    DynamicIslandHud.isAppDrawerOpen = false;
                    if (client.currentScreen instanceof AppDrawerScreen) {
                        client.setScreen(null);
                    }
                } else if (client.currentScreen == null) {
                    // Open App Drawer
                    isAppDrawerOpen = true;
                    DynamicIslandHud.isAppDrawerOpen = true;
                    isPebbleOpen = false;
                    isNotifCenterOpen = false;
                    isSettingsOpen = false;
                    isMediaOpen = false;
                    client.setScreen(new AppDrawerScreen());
                }
            }
            while (expandKeyBinding.wasPressed()) {
                if (client.currentScreen == null) {
                    isExpanded = !isExpanded;
                }
            }
            while (pauseKeyBinding.wasPressed()) {
                sendSpotifyCommand("spotify_toggle");
            }
            while (prevKeyBinding.wasPressed()) {
                sendSpotifyCommand("spotify_previous");
            }
            while (nextKeyBinding.wasPressed()) {
                sendSpotifyCommand("spotify_next");
            }
            while (lyricsKeyBinding.wasPressed()) {
                isLyricsMode = !isLyricsMode;
            }
            while (privacyKeyBinding.wasPressed()) {
                privacyMode = !privacyMode;
                if (privacyMode) {
                    // Reset aliases/skins so each toggle picks fresh randoms
                    com.cobble.dynamicisland.privacy.PrivacyState.resetAlias();
                    com.cobble.dynamicisland.privacy.PrivacyState.resetSkin();
                    triggerSilentNotification("\uD83D\uDEE1 Privacy Mode ON", "general");
                } else {
                    triggerSilentNotification("\uD83D\uDEE1 Privacy Mode OFF", "general");
                }
                DynamicIslandConfig.save();
            }
            while (networkStatsKeyBinding.wasPressed()) {
                NetworkStats.sendNetworkStats();
            }
            // T only OPENS media browser, never closes (ESC closes)
            while (mediaKeyBinding.wasPressed()) {
                if (InGameBrowser.isPlayingInBackground() && client.currentScreen == null) {
                    // Resume background browser
                    isMediaOpen = true;
                    isPebbleOpen = false;
                    isNotifCenterOpen = false;
                    isSettingsOpen = false;
                    isAppDrawerOpen = false;
                    DynamicIslandHud.isAppDrawerOpen = false;
                    InGameBrowser.openMedia();
                } else if (!isMediaOpen && client.currentScreen == null) {
                    isMediaOpen = true;
                    isPebbleOpen = false;
                    isNotifCenterOpen = false;
                    isSettingsOpen = false;
                    isAppDrawerOpen = false;
                    DynamicIslandHud.isAppDrawerOpen = false;
                    // Open in-game browser (YouTube/Twitch)
                    InGameBrowser.openMedia();
                }
            }
            // L opens Loomie AI chat
            while (loomieKeyBinding.wasPressed()) {
                if (!isPebbleOpen && client.currentScreen == null) {
                    isPebbleOpen = true;
                    isMediaOpen = false;
                    isNotifCenterOpen = false;
                    isSettingsOpen = false;
                    isAppDrawerOpen = false;
                    DynamicIslandHud.isAppDrawerOpen = false;
                    client.setScreen(new PebbleScreen());
                }
            }

            // Tick TPS tracker
            NetworkStats.tick();

            // Restore Spotify volume after ducking
            if (volumeRestoreTime > 0 && System.currentTimeMillis() >= volumeRestoreTime) {
                volumeRestoreTime = 0;
                sendSpotifyCommand("spotify_unduck");
            }

            // Play sound when a NEW persistent alert appears
            String currentPersistent = GameAlerts.persistentType;
            if (currentPersistent != null && !currentPersistent.equals(lastPersistentType)) {
                playNotificationSound();
                duckSpotifyVolume();
            }
            lastPersistentType = currentPersistent;
        });
    }

    public static void sendSpotifyCommand(String command) {
        if (LauncherWebSocket.getInstance() != null && LauncherWebSocket.getInstance().isOpen()) {
            LauncherWebSocket.getInstance().send("{\"type\":\"" + command + "\"}");
        }
    }

    public static void triggerNotification(String text) {
        triggerNotification(text, "general");
    }

    public static void triggerNotification(String text, String type) {
        currentNotification = text;
        notificationStartTime = System.currentTimeMillis();
        notificationEndTime = notificationStartTime + 4000;
        recordNotification(text, type);
        playNotificationSound();
        duckSpotifyVolume();
    }

    /** Silent notification — shows in HUD + history but no sound/music duck */
    public static void triggerSilentNotification(String text, String type) {
        currentNotification = text;
        notificationStartTime = System.currentTimeMillis();
        notificationEndTime = notificationStartTime + 3000;
        recordNotification(text, type);
    }

    private static void playNotificationSound() {
        MinecraftClient client = MinecraftClient.getInstance();
        if (client.player != null) {
            client.player.playSound(
                SoundEvents.BLOCK_NOTE_BLOCK_PLING.value(),
                1.0f,  // volume — loud enough over music
                1.8f   // pitch
            );
        }
    }

    private static void duckSpotifyVolume() {
        sendSpotifyCommand("spotify_duck");
        volumeRestoreTime = System.currentTimeMillis() + 3000; // restore in 3s
    }

    public static boolean hasNotification() {
        if (currentNotification != null && System.currentTimeMillis() > notificationEndTime) {
            currentNotification = null;
            return false;
        }
        return currentNotification != null;
    }

    /** Returns 0.0-1.0 for notification fade-in/fade-out animation */
    public static float getNotificationAlpha() {
        if (currentNotification == null) return 0f;
        long now = System.currentTimeMillis();
        long elapsed = now - notificationStartTime;
        long remaining = notificationEndTime - now;

        if (elapsed < 300) {
            return elapsed / 300f;
        } else if (remaining < 500) {
            return Math.max(0, remaining / 500f);
        }
        return 1f;
    }

    /** Detect whisper/DM messages in various formats */
    private static void handleWhisperMessage(String text) {
        // Skip outgoing whispers ("You whisper to PlayerName: ...")
        if (text.startsWith("You whisper")) return;

        // Patterns to detect incoming whispers:
        // 1. "PlayerName whispers to you: message"
        // 2. "PlayerName whispers: message"  
        // 3. "[PlayerName -> You] message" (some servers)
        // 4. "From PlayerName: message" (some servers)

        String sender = null;
        String msg = null;

        if (text.contains("whispers to you:")) {
            sender = text.substring(0, text.indexOf(" whispers")).trim();
            msg = text.substring(text.indexOf("whispers to you:") + 16).trim();
        } else if (text.contains("whispers:")) {
            sender = text.substring(0, text.indexOf(" whispers")).trim();
            msg = text.substring(text.indexOf("whispers:") + 9).trim();
        } else if (text.contains(" -> You]")) {
            // [Player -> You] message
            int start = text.indexOf("[");
            int arrow = text.indexOf(" -> You]");
            if (start >= 0 && arrow > start) {
                sender = text.substring(start + 1, arrow).trim();
                msg = text.substring(arrow + 8).trim();
            }
        } else if (text.startsWith("From ") && text.contains(":")) {
            sender = text.substring(5, text.indexOf(":")).trim();
            msg = text.substring(text.indexOf(":") + 1).trim();
        }

        if (sender != null && msg != null && !sender.isEmpty() && toggleWhisper) {
            if (msg.length() > 30) msg = msg.substring(0, 30) + "...";
            triggerNotification("\u2709 " + sender + ": " + msg, "whisper");
        }
    }
}
