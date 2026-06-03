package com.cobble.dynamicisland;

import com.google.gson.Gson;
import org.java_websocket.client.WebSocketClient;
import org.java_websocket.handshake.ServerHandshake;

import com.google.gson.JsonObject;
import java.net.URI;
import java.net.URISyntaxException;

public class LauncherWebSocket extends WebSocketClient {
    private static final Gson GSON = new Gson();
    private static LauncherWebSocket instance;
    private static String sessionToken = null;

    public static void connectToServer() {
        if (instance != null && !instance.isClosed()) return;
        sessionToken = System.getProperty("loom.ws.token", "");
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
        // Authenticate with the launcher before any other messages
        JsonObject authMsg = new JsonObject();
        authMsg.addProperty("type", "auth");
        authMsg.addProperty("token", sessionToken);
        send(authMsg.toString());
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
            } else if (message.contains("\"type\":\"twitch_chat\"")) {
                java.util.Map map = GSON.fromJson(message, java.util.Map.class);
                String username = (String) map.get("username");
                String chatMsg = (String) map.get("message");
                String color = (String) map.get("color");
                if (color == null) color = "#FFFFFF";

                // Parse badges array
                String[] badges = new String[0];
                Object badgesObj = map.get("badges");
                if (badgesObj instanceof java.util.List<?> badgeList) {
                    badges = new String[badgeList.size()];
                    for (int i = 0; i < badgeList.size(); i++) {
                        badges[i] = String.valueOf(badgeList.get(i));
                    }
                }

                if (username != null && chatMsg != null) {
                    final String finalColor = color;
                    final String[] finalBadges = badges;
                    net.minecraft.client.MinecraftClient.getInstance().execute(() -> {
                        TwitchChat.addMessage(username, chatMsg, finalColor, finalBadges);
                    });
                }
            } else if (message.contains("\"type\":\"media_play\"")) {
                java.util.Map map = GSON.fromJson(message, java.util.Map.class);
                String url = (String) map.get("url");
                String source = (String) map.get("source");
                String title = (String) map.get("title");
                if (url != null && source != null) {
                    MediaViewer.MediaType type = "twitch".equals(source)
                        ? MediaViewer.MediaType.TWITCH
                        : MediaViewer.MediaType.YOUTUBE;
                    final String finalTitle = title;
                    net.minecraft.client.MinecraftClient.getInstance().execute(() -> {
                        MediaViewer.openStream(url, type);
                        if (finalTitle != null && !finalTitle.isEmpty()) {
                            MediaViewer.currentTitle = finalTitle;
                        }
                        DynamicIslandMod.isMediaOpen = true;
                    });
                }
            } else if (message.contains("\"type\":\"media_stop\"")) {
                net.minecraft.client.MinecraftClient.getInstance().execute(() -> {
                    MediaViewer.closeStream();
                    DynamicIslandMod.isMediaOpen = false;
                });
            } else if (message.contains("\"type\":\"media_search_results\"")) {
                // Parse search results from launcher
                java.util.Map map = GSON.fromJson(message, java.util.Map.class);
                Object resultsObj = map.get("results");
                if (resultsObj instanceof java.util.List) {
                    java.util.List resultsList = (java.util.List) resultsObj;
                    java.util.List<MediaViewer.SearchResult> parsed = new java.util.ArrayList<>();
                    for (Object item : resultsList) {
                        if (item instanceof java.util.Map) {
                            java.util.Map r = (java.util.Map) item;
                            MediaViewer.SearchResult sr = new MediaViewer.SearchResult();
                            sr.id = r.get("id") != null ? r.get("id").toString() : "";
                            sr.title = r.get("title") != null ? r.get("title").toString() : "";
                            sr.source = r.get("source") != null ? r.get("source").toString() : "";
                            sr.thumbnail = r.get("thumbnail") != null ? r.get("thumbnail").toString() : "";
                            sr.duration = r.get("duration") != null ? r.get("duration").toString() : "";
                            sr.channel = r.get("channel") != null ? r.get("channel").toString() : "";
                            sr.url = r.get("url") != null ? r.get("url").toString() : "";
                            if (r.get("viewers") instanceof Number) {
                                sr.viewers = ((Number) r.get("viewers")).intValue();
                            }
                            // Base64 thumbnail data from Electron
                            String thumbB64 = r.get("thumbnailBase64") != null ? r.get("thumbnailBase64").toString() : "";
                            if (!thumbB64.isEmpty() && !sr.thumbnail.isEmpty()) {
                                ThumbnailCache.putBase64(sr.thumbnail, thumbB64);
                            }
                            parsed.add(sr);
                        }
                    }
                    net.minecraft.client.MinecraftClient.getInstance().execute(() -> {
                        MediaViewer.receiveSearchResults(parsed);
                    });
                }
            } else if (message.contains("\"type\":\"twitch_live\"")) {
                java.util.Map map = GSON.fromJson(message, java.util.Map.class);
                String channel = (String) map.get("channel");
                String game = (String) map.get("game");
                Object viewersObj = map.get("viewers");
                int viewers = 0;
                if (viewersObj instanceof Number) {
                    viewers = ((Number) viewersObj).intValue();
                }
                if (channel != null) {
                    String notifText = channel + " is live"
                        + (game != null ? " playing " + game : "")
                        + (viewers > 0 ? " (" + viewers + " viewers)" : "");
                    final String finalNotif = notifText;
                    net.minecraft.client.MinecraftClient.getInstance().execute(() -> {
                        DynamicIslandMod.triggerNotification(finalNotif);
                    });
                }
            } else if (message.contains("\"type\":\"p2p_open_lan\"")) {
                java.util.Map map = GSON.fromJson(message, java.util.Map.class);
                com.google.gson.JsonObject jsonData = GSON.toJsonTree(map).getAsJsonObject();
                com.cobble.dynamicisland.p2p.P2PHandler.handleOpenLAN(jsonData);
            } else if (message.contains("\"type\":\"p2p_close_lan\"")) {
                com.cobble.dynamicisland.p2p.P2PHandler.handleCloseLAN();
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

    /** Send a JSON message to the launcher via WebSocket */
    public static void sendMessage(String json) {
        if (instance != null && instance.isOpen()) {
            instance.send(json);
        }
    }
}
