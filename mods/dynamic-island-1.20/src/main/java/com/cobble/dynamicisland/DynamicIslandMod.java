package com.cobble.dynamicisland;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import org.lwjgl.glfw.GLFW;

public class DynamicIslandMod implements ClientModInitializer {
    public static LauncherState currentState = null;
    public static String currentNotification = null;
    private static long notificationStartTime = 0;
    private static long notificationEndTime = 0;
    private static KeyBinding pebbleKeyBinding;
    private static KeyBinding expandKeyBinding;
    private static KeyBinding networkStatsKeyBinding;
    public static boolean isExpanded = false;

    @Override
    public void onInitializeClient() {
        System.out.println("[DynamicIsland] Starting up...");
        LauncherWebSocket.connectToServer();

        HudRenderCallback.EVENT.register(new DynamicIslandHud());

        // Press P to open Pebble AI chat
        pebbleKeyBinding = KeyBindingHelper.registerKeyBinding(new KeyBinding(
            "Ask Pebble", 
            InputUtil.Type.KEYSYM,
            GLFW.GLFW_KEY_P,
            "Dynamic Island"
        ));

        // Press M to expand/collapse music controls
        expandKeyBinding = KeyBindingHelper.registerKeyBinding(new KeyBinding(
            "Expand Island", 
            InputUtil.Type.KEYSYM,
            GLFW.GLFW_KEY_M,
            "Dynamic Island"
        ));

        // Press F7 to show network stats (ping + TPS)
        networkStatsKeyBinding = KeyBindingHelper.registerKeyBinding(new KeyBinding(
            "Network Stats",
            InputUtil.Type.KEYSYM,
            GLFW.GLFW_KEY_F7,
            "Dynamic Island"
        ));

        // Clear TPS state on disconnect
        ClientPlayConnectionEvents.DISCONNECT.register((handler, client) -> {
            NetworkStats.reset();
            currentNotification = null;
            notificationEndTime = 0;
        });

        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            while (pebbleKeyBinding.wasPressed()) {
                if (client.currentScreen == null) {
                    client.setScreen(new PebbleScreen());
                }
            }
            while (expandKeyBinding.wasPressed()) {
                if (client.currentScreen == null) {
                    isExpanded = !isExpanded;
                }
            }
            while (networkStatsKeyBinding.wasPressed()) {
                NetworkStats.sendNetworkStats();
            }

            // Tick TPS tracker
            NetworkStats.tick();
        });
    }

    public static void triggerNotification(String text) {
        currentNotification = text;
        notificationStartTime = System.currentTimeMillis();
        notificationEndTime = notificationStartTime + 4000; // Show for 4 seconds
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
            // Fade in (0-300ms)
            return elapsed / 300f;
        } else if (remaining < 500) {
            // Fade out (last 500ms)
            return Math.max(0, remaining / 500f);
        }
        return 1f;
    }
}
