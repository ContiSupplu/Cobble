package com.cobble.dynamicisland;

import com.google.gson.Gson;
import org.java_websocket.client.WebSocketClient;
import org.java_websocket.handshake.ServerHandshake;

import java.net.URI;
import java.net.URISyntaxException;

public class LauncherWebSocket extends WebSocketClient {
    private static final Gson GSON = new Gson();
    private static LauncherWebSocket instance;

    public static void connectToServer() {
        if (instance != null && !instance.isClosed()) return;
        try {
            instance = new LauncherWebSocket(new URI("ws://127.0.0.1:47521"));
            instance.connect();
        } catch (URISyntaxException e) {
            e.printStackTrace();
        }
    }

    public LauncherWebSocket(URI serverUri) {
        super(serverUri);
    }

    @Override
    public void onOpen(ServerHandshake handshakedata) {
        System.out.println("[DynamicIsland] Connected to launcher WebSocket");
    }

    public static LauncherWebSocket getInstance() {
        return instance;
    }

    @Override
    public void onMessage(String message) {
        try {
            LauncherState state = GSON.fromJson(message, LauncherState.class);
            if ("state".equals(state.type)) {
                DynamicIslandMod.currentState = state;
            } else if ("notification".equals(state.type)) {
                DynamicIslandMod.triggerNotification(state.notification); // Use state.notification
            } else if (message.contains("\"type\":\"pebble_answer\"")) {
                java.util.Map map = GSON.fromJson(message, java.util.Map.class);
                String ans = (String) map.get("text");
                if (ans != null) {
                    net.minecraft.client.MinecraftClient.getInstance().execute(() -> {
                        DynamicIslandMod.addPebbleAnswer(ans);
                    });
                }
            }
        } catch (Exception e) {
            // Ignore parse errors
        }
    }

    @Override
    public void onClose(int code, String reason, boolean remote) {
        System.out.println("[DynamicIsland] Disconnected from launcher WebSocket. Reconnecting in 5s...");
        instance = null;
        new Thread(() -> {
            try {
                Thread.sleep(5000);
                connectToServer();
            } catch (InterruptedException e) {
                e.printStackTrace();
            }
        }).start();
    }

    @Override
    public void onError(Exception ex) {
        // Suppress print to avoid spam when launcher isn't running
    }
}
