package com.cobble.dynamicisland;

import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.ClientPlayerEntity;

import java.io.*;
import java.nio.file.*;
import java.util.ArrayList;
import java.util.List;

public class WaypointManager {

    public static class Waypoint {
        public String name;
        public int x;
        public int y;
        public int z;
        public String dimension;
        public int color; // ARGB

        public Waypoint(String name, int x, int y, int z, String dimension, int color) {
            this.name = name;
            this.x = x;
            this.y = y;
            this.z = z;
            this.dimension = dimension;
            this.color = color;
        }
    }

    private static final int MAX_WAYPOINTS = 20;
    private static final int PROXIMITY_THRESHOLD = 5;
    private static final int CHECK_INTERVAL = 20; // ticks

    private static final int[] PRESET_COLORS = {
        0xFF4CAF50, // green
        0xFF2196F3, // blue
        0xFFF44336, // red
        0xFFFF9800, // orange
        0xFF9C27B0, // purple
        0xFF00BCD4  // cyan
    };

    private static final List<Waypoint> waypoints = new ArrayList<>();
    public static Waypoint activeWaypoint = null;
    private static int tickCounter = 0;
    private static int colorIndex = 0;

    // ── Waypoint Management ──────────────────────────────────────────────

    public static boolean addWaypoint(String name, int x, int y, int z, String dimension) {
        if (waypoints.size() >= MAX_WAYPOINTS) {
            return false;
        }
        int color = PRESET_COLORS[colorIndex % PRESET_COLORS.length];
        colorIndex++;
        waypoints.add(new Waypoint(name, x, y, z, dimension, color));
        save();
        return true;
    }

    public static void removeWaypoint(int index) {
        if (index < 0 || index >= waypoints.size()) {
            return;
        }
        Waypoint removed = waypoints.remove(index);
        if (activeWaypoint == removed) {
            activeWaypoint = null;
        }
        save();
    }

    public static List<Waypoint> getWaypoints() {
        return waypoints;
    }

    // ── Navigation ───────────────────────────────────────────────────────

    public static void startNavigation(int index) {
        if (index < 0 || index >= waypoints.size()) {
            return;
        }
        activeWaypoint = waypoints.get(index);
        DynamicIslandMod.triggerNotification(
            "Navigating to " + activeWaypoint.name, "NAVIGATION"
        );
    }

    public static void cancelNavigation() {
        if (activeWaypoint != null) {
            DynamicIslandMod.triggerNotification(
                "Navigation cancelled", "NAVIGATION"
            );
            activeWaypoint = null;
        }
    }

    // ── Distance & Direction ─────────────────────────────────────────────

    public static double getDistance(double playerX, double playerZ) {
        if (activeWaypoint == null) return -1;
        double dx = activeWaypoint.x - playerX;
        double dz = activeWaypoint.z - playerZ;
        return Math.sqrt(dx * dx + dz * dz);
    }

    public static String getDirection(double playerX, double playerZ, float playerYaw) {
        if (activeWaypoint == null) return "";

        double dx = activeWaypoint.x - playerX;
        double dz = activeWaypoint.z - playerZ;

        // Angle from player to waypoint in degrees (0 = south, clockwise)
        double angleToWaypoint = Math.toDegrees(Math.atan2(-dx, dz));

        // Relative angle: subtract player yaw, normalize to -180..180
        double relative = angleToWaypoint - playerYaw;
        relative = ((relative % 360) + 360) % 360;
        if (relative > 180) relative -= 360;

        // Convert relative angle to compass direction
        // 0 = straight ahead (the direction the player faces)
        // We map to world-compass labels based on absolute angle
        double worldAngle = ((angleToWaypoint % 360) + 360) % 360;

        if (worldAngle >= 337.5 || worldAngle < 22.5) return "S";
        if (worldAngle >= 22.5 && worldAngle < 67.5) return "SW";
        if (worldAngle >= 67.5 && worldAngle < 112.5) return "W";
        if (worldAngle >= 112.5 && worldAngle < 157.5) return "NW";
        if (worldAngle >= 157.5 && worldAngle < 202.5) return "N";
        if (worldAngle >= 202.5 && worldAngle < 247.5) return "NE";
        if (worldAngle >= 247.5 && worldAngle < 292.5) return "E";
        if (worldAngle >= 292.5 && worldAngle < 337.5) return "SE";

        return "N";
    }

    public static String getRelativeDirection(double playerX, double playerZ, float playerYaw) {
        if (activeWaypoint == null) return "";
        double dx = activeWaypoint.x - playerX;
        double dz = activeWaypoint.z - playerZ;
        double angleToWaypoint = Math.toDegrees(Math.atan2(-dx, dz));
        double relative = angleToWaypoint - playerYaw;
        relative = ((relative % 360) + 360) % 360;
        if (relative > 180) relative -= 360;
        // 0 = ahead, positive = right, negative = left
        if (relative >= -45 && relative <= 45) return "ahead";
        if (relative > 45 && relative < 135) return "right";
        if (relative < -45 && relative > -135) return "left";
        return "behind";
    }

    public static boolean isNearWaypoint(double playerX, double playerY, double playerZ) {
        if (activeWaypoint == null) return false;

        double dx = activeWaypoint.x + 0.5 - playerX;
        double dy = activeWaypoint.y + 0.5 - playerY;
        double dz = activeWaypoint.z + 0.5 - playerZ;
        double dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist <= PROXIMITY_THRESHOLD) {
            DynamicIslandMod.triggerNotification(
                "Arrived at " + activeWaypoint.name + "!", "NAVIGATION"
            );
            activeWaypoint = null;
            return true;
        }
        return false;
    }

    // ── Dimension Helper ─────────────────────────────────────────────────

    public static String getDimensionShort(String dimension) {
        if (dimension == null) return "OW";
        if (dimension.contains("the_nether") || dimension.contains("nether")) return "Nether";
        if (dimension.contains("the_end") || dimension.contains("end")) return "End";
        return "OW";
    }

    // ── Registration ─────────────────────────────────────────────────────

    public static void register() {
        load();
        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            if (client.player == null || activeWaypoint == null) return;

            tickCounter++;
            if (tickCounter >= CHECK_INTERVAL) {
                tickCounter = 0;
                ClientPlayerEntity player = client.player;
                isNearWaypoint(player.getX(), player.getY(), player.getZ());
            }
        });
    }

    // ── JSON Persistence ─────────────────────────────────────────────────

    private static Path getConfigPath() {
        return FabricLoader.getInstance().getConfigDir().resolve("dynamic-island-waypoints.json");
    }

    public static void save() {
        try {
            StringBuilder sb = new StringBuilder();
            sb.append("[\n");
            for (int i = 0; i < waypoints.size(); i++) {
                Waypoint wp = waypoints.get(i);
                sb.append("  {\n");
                sb.append("    \"name\": \"").append(escapeJson(wp.name)).append("\",\n");
                sb.append("    \"x\": ").append(wp.x).append(",\n");
                sb.append("    \"y\": ").append(wp.y).append(",\n");
                sb.append("    \"z\": ").append(wp.z).append(",\n");
                sb.append("    \"dimension\": \"").append(escapeJson(wp.dimension)).append("\",\n");
                sb.append("    \"color\": ").append(wp.color).append("\n");
                sb.append("  }");
                if (i < waypoints.size() - 1) {
                    sb.append(",");
                }
                sb.append("\n");
            }
            sb.append("]\n");

            Files.writeString(getConfigPath(), sb.toString());
        } catch (IOException e) {
            System.err.println("[DynamicIsland] Failed to save waypoints: " + e.getMessage());
        }
    }

    public static void load() {
        Path path = getConfigPath();
        if (!Files.exists(path)) return;

        try {
            String content = Files.readString(path);
            waypoints.clear();
            colorIndex = 0;

            // Simple manual JSON array parsing
            // Find each { ... } block in the array
            int searchFrom = 0;
            while (true) {
                int objStart = content.indexOf('{', searchFrom);
                if (objStart == -1) break;
                int objEnd = content.indexOf('}', objStart);
                if (objEnd == -1) break;

                String obj = content.substring(objStart, objEnd + 1);

                String name = extractStringValue(obj, "name");
                int x = extractIntValue(obj, "x");
                int y = extractIntValue(obj, "y");
                int z = extractIntValue(obj, "z");
                String dimension = extractStringValue(obj, "dimension");
                int color = extractIntValue(obj, "color");

                if (name != null && dimension != null) {
                    waypoints.add(new Waypoint(name, x, y, z, dimension, color));
                    colorIndex++;
                }

                searchFrom = objEnd + 1;
            }

            System.out.println("[DynamicIsland] Loaded " + waypoints.size() + " waypoints");
        } catch (IOException e) {
            System.err.println("[DynamicIsland] Failed to load waypoints: " + e.getMessage());
        }
    }

    // ── JSON Utility Methods ─────────────────────────────────────────────

    private static String escapeJson(String value) {
        if (value == null) return "";
        return value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t");
    }

    private static String extractStringValue(String json, String key) {
        String search = "\"" + key + "\"";
        int keyIdx = json.indexOf(search);
        if (keyIdx == -1) return null;

        // Find the colon after the key
        int colonIdx = json.indexOf(':', keyIdx + search.length());
        if (colonIdx == -1) return null;

        // Find the opening quote of the value
        int openQuote = json.indexOf('"', colonIdx + 1);
        if (openQuote == -1) return null;

        // Find the closing quote, handling escaped quotes
        int closeQuote = openQuote + 1;
        while (closeQuote < json.length()) {
            char c = json.charAt(closeQuote);
            if (c == '\\') {
                closeQuote += 2; // skip escaped character
                continue;
            }
            if (c == '"') break;
            closeQuote++;
        }

        if (closeQuote >= json.length()) return null;

        String raw = json.substring(openQuote + 1, closeQuote);
        // Unescape basic sequences
        return raw
            .replace("\\\"", "\"")
            .replace("\\\\", "\\")
            .replace("\\n", "\n")
            .replace("\\r", "\r")
            .replace("\\t", "\t");
    }

    private static int extractIntValue(String json, String key) {
        String search = "\"" + key + "\"";
        int keyIdx = json.indexOf(search);
        if (keyIdx == -1) return 0;

        int colonIdx = json.indexOf(':', keyIdx + search.length());
        if (colonIdx == -1) return 0;

        // Skip whitespace after colon
        int start = colonIdx + 1;
        while (start < json.length() && Character.isWhitespace(json.charAt(start))) {
            start++;
        }

        // Read digits, optional leading minus
        StringBuilder numStr = new StringBuilder();
        if (start < json.length() && json.charAt(start) == '-') {
            numStr.append('-');
            start++;
        }
        while (start < json.length() && Character.isDigit(json.charAt(start))) {
            numStr.append(json.charAt(start));
            start++;
        }

        if (numStr.length() == 0 || numStr.toString().equals("-")) return 0;

        try {
            return (int) Long.parseLong(numStr.toString());
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
