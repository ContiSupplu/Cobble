package com.cobble.dynamicisland;

import java.util.ArrayList;
import java.util.List;

/**
 * Stores Twitch chat messages received from the launcher via WebSocket.
 * Rendering is handled by DynamicIslandHud; input capture by TwitchScreen.
 */
public class TwitchChat {
    public static final List<ChatMsg> messages = new ArrayList<>();
    public static String inputText = "";
    public static int scroll = 0;
    private static final int MAX_MESSAGES = 100;

    public static class ChatMsg {
        public final String username;
        public final String message;
        public final String color; // hex color like "#FF0000"
        public final String[] badges; // "mod", "sub", "vip"
        public final long timestamp;

        public ChatMsg(String username, String message, String color, String[] badges) {
            this.username = username;
            this.message = message;
            this.color = color;
            this.badges = badges;
            this.timestamp = System.currentTimeMillis();
        }
    }

    public static void addMessage(String username, String message, String color, String[] badges) {
        messages.add(0, new ChatMsg(username, message, color, badges));
        while (messages.size() > MAX_MESSAGES) {
            messages.remove(messages.size() - 1);
        }
        scroll = 0; // auto-scroll to bottom (newest)
    }

    public static void sendMessage(String text) {
        if (LauncherWebSocket.getInstance() != null && LauncherWebSocket.getInstance().isOpen()) {
            LauncherWebSocket.getInstance().send(
                "{\"type\":\"twitch_send_chat\",\"message\":\"" +
                text.replace("\\", "\\\\").replace("\"", "\\\"") + "\"}"
            );
        }
    }

    public static void clear() {
        messages.clear();
        scroll = 0;
    }
}
