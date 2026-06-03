package com.cobble.dynamicisland.p2p;

import com.cobble.dynamicisland.DynamicIslandMod;
import com.cobble.dynamicisland.LauncherWebSocket;
import com.google.gson.JsonObject;
import net.minecraft.client.MinecraftClient;
import net.minecraft.server.integrated.IntegratedServer;
import net.minecraft.world.GameMode;

public class P2PHandler {

    private static boolean lanOpen = false;

    /**
     * Called when the launcher sends a p2p_open_lan command.
     * Opens the current singleplayer world to LAN.
     */
    public static void handleOpenLAN(JsonObject data) {
        MinecraftClient client = MinecraftClient.getInstance();
        if (client == null || client.getServer() == null) {
            sendError("No singleplayer world is loaded");
            return;
        }

        IntegratedServer server = client.getServer();

        // Parse game mode from data, default to survival
        GameMode gameMode = GameMode.SURVIVAL;
        if (data != null && data.has("gameMode")) {
            String mode = data.get("gameMode").getAsString().toUpperCase();
            try {
                gameMode = GameMode.valueOf(mode);
            } catch (IllegalArgumentException ignored) {}
        }

        boolean cheats = data != null && data.has("cheats") && data.get("cheats").getAsBoolean();

        final GameMode finalMode = gameMode;
        final boolean finalCheats = cheats;

        // Must run on the main client thread
        client.execute(() -> {
            try {
                // Check if already open to LAN
                if (server.isRemote()) {
                    // Already open — report current port
                    int port = server.getServerPort();
                    sendLanOpened(port);
                    return;
                }

                // Open to LAN — returns true on success, false on failure
                // Pass 0 to let MC pick a random available port
                boolean success = server.openToLan(finalMode, finalCheats, 0);

                if (success) {
                    lanOpen = true;
                    int port = server.getServerPort();
                    sendLanOpened(port);
                    System.out.println("[Loom P2P] Opened to LAN on port " + port);

                    // Show in-game notification
                    DynamicIslandMod.triggerSilentNotification(
                        "\u26A1 World opened for friends", "general"
                    );
                } else {
                    sendError("Failed to open to LAN");
                }
            } catch (Exception e) {
                System.err.println("[Loom P2P] Error opening to LAN: " + e.getMessage());
                sendError("Error: " + e.getMessage());
            }
        });
    }

    /**
     * Called when the launcher sends a p2p_close_lan command.
     * Note: Minecraft doesn't have a clean "close LAN" API.
     * The LAN session ends when the world is closed.
     */
    public static void handleCloseLAN() {
        lanOpen = false;
        LauncherWebSocket.sendMessage("{\"type\":\"p2p_lan_closed\"}");
        DynamicIslandMod.triggerSilentNotification(
            "\u26A1 Friend session ended", "general"
        );
    }

    /**
     * Called when the player presses "Play with Friends" in the pause menu.
     * Sends a request to the launcher to start the P2P invite flow.
     */
    public static void requestInvite() {
        MinecraftClient client = MinecraftClient.getInstance();
        if (client == null || !client.isInSingleplayer()) {
            return;
        }

        LauncherWebSocket.sendMessage("{\"type\":\"p2p_request_invite\"}");
        DynamicIslandMod.triggerSilentNotification(
            "\u26A1 Check Loom for your invite link", "general"
        );
    }

    public static boolean isLanOpen() {
        return lanOpen;
    }

    public static void reset() {
        lanOpen = false;
    }

    private static void sendLanOpened(int port) {
        LauncherWebSocket.sendMessage(
            "{\"type\":\"p2p_lan_opened\",\"port\":" + port + "}"
        );
    }

    private static void sendError(String message) {
        LauncherWebSocket.sendMessage(
            "{\"type\":\"p2p_error\",\"message\":\"" + message.replace("\"", "\\\"") + "\"}"
        );
    }
}
