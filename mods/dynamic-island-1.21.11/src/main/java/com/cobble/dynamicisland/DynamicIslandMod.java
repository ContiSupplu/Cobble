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
import net.minecraft.util.Identifier;
import org.lwjgl.glfw.GLFW;

import java.util.ArrayList;
import java.util.List;

public class DynamicIslandMod implements ClientModInitializer {
    private static final KeyBinding.Category CATEGORY = KeyBinding.Category.create(Identifier.of("cobble", "dynamic_island"));
    public static LauncherState currentState = null;
    public static String currentNotification = null;
    private static long notificationStartTime = 0;
    private static long notificationEndTime = 0;
    private static KeyBinding pebbleKeyBinding;
    private static KeyBinding expandKeyBinding;
    private static KeyBinding pauseKeyBinding;
    private static KeyBinding prevKeyBinding;
    private static KeyBinding nextKeyBinding;
    private static KeyBinding lyricsKeyBinding;
    public static boolean isExpanded = false;
    public static boolean isLyricsMode = false;
    private static long volumeRestoreTime = 0;
    private static String lastPersistentType = null;

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
        LauncherWebSocket.connectToServer();

        HudRenderCallback.EVENT.register(new DynamicIslandHud());

        // Register game alert system
        GameAlerts.register();

        // Register inventory gesture system
        GestureHandler.register();

        // Register new systems
        TimerManager.register();
        WaypointManager.register();
        CombatTracker.register();

        // Clear world-specific state on disconnect (switching servers/worlds)
        ClientPlayConnectionEvents.DISCONNECT.register((handler, client) -> {
            GameAlerts.clearPersistent();
            WaypointManager.cancelNavigation();
            CombatTracker.endCombat();
            TimerManager.dismissFinishedTimer();
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

        // Press P to open Pebble AI chat
        pebbleKeyBinding = KeyBindingHelper.registerKeyBinding(new KeyBinding(
            "Ask Pebble", 
            InputUtil.Type.KEYSYM,
            GLFW.GLFW_KEY_P,
            CATEGORY
        ));

        // Press M to expand/collapse music controls
        expandKeyBinding = KeyBindingHelper.registerKeyBinding(new KeyBinding(
            "Expand Island", 
            InputUtil.Type.KEYSYM,
            GLFW.GLFW_KEY_M,
            CATEGORY
        ));

        // Music controls
        pauseKeyBinding = KeyBindingHelper.registerKeyBinding(new KeyBinding(
            "Play/Pause Music",
            InputUtil.Type.KEYSYM,
            GLFW.GLFW_KEY_GRAVE_ACCENT,
            CATEGORY
        ));

        prevKeyBinding = KeyBindingHelper.registerKeyBinding(new KeyBinding(
            "Previous Track",
            InputUtil.Type.KEYSYM,
            GLFW.GLFW_KEY_LEFT_BRACKET,
            CATEGORY
        ));

        nextKeyBinding = KeyBindingHelper.registerKeyBinding(new KeyBinding(
            "Next Track",
            InputUtil.Type.KEYSYM,
            GLFW.GLFW_KEY_RIGHT_BRACKET,
            CATEGORY
        ));

        lyricsKeyBinding = KeyBindingHelper.registerKeyBinding(new KeyBinding(
            "Toggle Lyrics",
            InputUtil.Type.KEYSYM,
            GLFW.GLFW_KEY_K,
            CATEGORY
        ));

        KeyBinding notifCenterKeyBinding = KeyBindingHelper.registerKeyBinding(new KeyBinding(
            "Notification Center",
            InputUtil.Type.KEYSYM,
            GLFW.GLFW_KEY_N,
            CATEGORY
        ));

        KeyBinding settingsKeyBinding = KeyBindingHelper.registerKeyBinding(new KeyBinding(
            "Settings",
            InputUtil.Type.KEYSYM,
            GLFW.GLFW_KEY_G,
            CATEGORY
        ));

        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            while (pebbleKeyBinding.wasPressed()) {
                if (isPebbleOpen) {
                    // Close Pebble
                    isPebbleOpen = false;
                    if (client.currentScreen instanceof PebbleScreen) {
                        client.setScreen(null);
                    }
                } else if (client.currentScreen == null) {
                    // Open Pebble
                    isPebbleOpen = true;
                    client.setScreen(new PebbleScreen());
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
            while (notifCenterKeyBinding.wasPressed()) {
                if (isNotifCenterOpen) {
                    isNotifCenterOpen = false;
                    if (client.currentScreen instanceof NotifCenterScreen) {
                        client.setScreen(null);
                    }
                } else if (client.currentScreen == null) {
                    isNotifCenterOpen = true;
                    isSettingsOpen = false;
                    isPebbleOpen = false;
                    client.setScreen(new NotifCenterScreen());
                }
            }
            while (settingsKeyBinding.wasPressed()) {
                if (isSettingsOpen) {
                    isSettingsOpen = false;
                    if (client.currentScreen instanceof SettingsScreen) {
                        client.setScreen(null);
                    }
                } else if (client.currentScreen == null) {
                    isSettingsOpen = true;
                    isNotifCenterOpen = false;
                    isPebbleOpen = false;
                    client.setScreen(new SettingsScreen());
                }
            }

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
