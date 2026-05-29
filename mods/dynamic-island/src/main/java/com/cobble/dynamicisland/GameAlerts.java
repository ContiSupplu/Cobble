package com.cobble.dynamicisland;

import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.AbstractClientPlayerEntity;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.client.network.PlayerListEntry;
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.entity.EquipmentSlot;
import net.minecraft.item.ItemStack;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.BlockPos;
import net.minecraft.item.Items;

import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

public class GameAlerts {

    // ── Death tracking ─────────────────────────────
    public static BlockPos deathPos = null;
    public static String deathDimension = null;
    public static boolean deathActive = false;

    // ── Persistent alert ───────────────────────────
    public static String persistentText = null;
    public static String persistentType = null;
    public static boolean persistentIsAlert = false;

    // ── Biome subtitle (footnote, not notification) ─
    public static String biomeSubtitle = null;
    public static long biomeSubtitleUntil = 0;

    // ── Song peek (show music briefly during death) ─
    public static String lastSongTitle = null;
    public static long songPeekUntil = 0;

    // ── Internal state ─────────────────────────────
    private static boolean wasDead = false;
    private static float lastHealth = 20f;
    private static boolean lowHungerShown = false;
    private static boolean inventoryFullShown = false;
    private static int lastTrackedDurability = -1;
    private static String lastTrackedItemName = null;
    private static String lastBiome = null;
    private static final Set<UUID> knownPlayers = new HashSet<>();
    private static boolean playersInitialized = false;

    // ── Player head for notification ───────────────
    public static Identifier notificationHeadTexture = null;
    public static long notificationHeadUntil = 0;

    // ── Thresholds ─────────────────────────────────
    private static final int HEALTH_THRESHOLD = 6;
    private static final int HUNGER_THRESHOLD = 6;
    private static final int DURABILITY_USES_WARN = 10;
    private static final int EFFECT_SECONDS_WARN = 10;

    public static void clearPersistent() {
        persistentText = null;
        persistentType = null;
        persistentIsAlert = false;
        deathPos = null;
        deathDimension = null;
        deathActive = false;
        biomeSubtitle = null;
        biomeSubtitleUntil = 0;
        notificationHeadTexture = null;
        notificationHeadUntil = 0;
    }

    public static void register() {
        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            if (client.player == null || client.world == null) return;

            ClientPlayerEntity player = client.player;

            checkDeath(player);

            // ── Song peek detection ────────────────
            LauncherState state = DynamicIslandMod.currentState;
            if (state != null && state.spotify != null && state.spotify.title != null) {
                if (!state.spotify.title.equals(lastSongTitle)) {
                    lastSongTitle = state.spotify.title;
                    if (deathActive) {
                        songPeekUntil = System.currentTimeMillis() + 5000;
                    }
                }
            }

            // ── Persistent alerts (priority order) ──
            String newText = null;
            String newType = null;
            boolean newIsAlert = false;

            String elytra = checkElytraFlight(player);
            if (elytra != null) {
                newText = elytra; newType = "elytra"; newIsAlert = true;
            }

            if (newText == null) {
                String effect = checkEffectExpiring(player);
                if (effect != null) {
                    newText = effect; newType = "effect"; newIsAlert = true;
                }
            }

            if (newText == null) {
                String dura = checkDurability(player);
                if (dura != null) {
                    newText = dura; newType = "durability"; newIsAlert = true;
                }
            }

            if (newText == null && deathActive && deathPos != null && !player.isDead()) {
                newText = getDeathDisplay(player);
                newType = "death";
                newIsAlert = false;
            }

            persistentText = newText;
            persistentType = newType;
            persistentIsAlert = newIsAlert;

            // ── One-shot checks (1/sec) ────────────
            if (client.world.getTime() % 20 == 0) {
                checkHealth(player);
                checkHunger(player);
                checkInventoryFull(player);
                checkDeathProximity(player);
                checkBiomeChange(player);
                checkNearbyPlayers(client);
            }
        });
    }

    // ══════════════════════════════════════════════════
    // PERSISTENT ALERTS
    // ══════════════════════════════════════════════════

    private static String checkElytraFlight(ClientPlayerEntity player) {
        if (!player.isFallFlying()) return null;
        ItemStack chest = player.getEquippedStack(EquipmentSlot.CHEST);
        if (chest.isEmpty() || !chest.isOf(Items.ELYTRA)) return null;
        int remaining = chest.getMaxDamage() - chest.getDamage();
        if (remaining > DURABILITY_USES_WARN) return null;
        return "Elytra: " + remaining + "s flight left!";
    }

    private static String checkEffectExpiring(ClientPlayerEntity player) {
        Collection<StatusEffectInstance> effects = player.getStatusEffects();
        String worstName = null;
        int worstSeconds = Integer.MAX_VALUE;

        for (StatusEffectInstance effect : effects) {
            int seconds = effect.getDuration() / 20;
            if (seconds <= EFFECT_SECONDS_WARN && seconds > 0) {
                String name = effect.getEffectType().value().getName().getString();
                if (seconds < worstSeconds) {
                    worstSeconds = seconds;
                    worstName = name;
                }
            }
        }
        return worstName != null ? worstName + ": " + worstSeconds + "s left" : null;
    }

    private static boolean armorWarned_head = false;
    private static boolean armorWarned_chest = false;
    private static boolean armorWarned_legs = false;
    private static boolean armorWarned_feet = false;

    private static String checkDurability(ClientPlayerEntity player) {
        // Tools: only show when player is actively using (swinging hand)
        if (player.handSwinging) {
            ItemStack held = player.getMainHandStack();
            if (!held.isEmpty() && held.isDamageable()) {
                int remaining = held.getMaxDamage() - held.getDamage();
                if (remaining > 0 && remaining <= DURABILITY_USES_WARN) {
                    return held.getName().getString() + ": " + remaining + " uses left";
                }
            }
        }

        // Armor: one-shot notification when close to broken, then reset when replaced
        checkArmorSlot(player, EquipmentSlot.HEAD, "armorWarned_head");
        checkArmorSlot(player, EquipmentSlot.CHEST, "armorWarned_chest");
        checkArmorSlot(player, EquipmentSlot.LEGS, "armorWarned_legs");
        checkArmorSlot(player, EquipmentSlot.FEET, "armorWarned_feet");

        return null;
    }

    private static void checkArmorSlot(ClientPlayerEntity player, EquipmentSlot slot, String flag) {
        ItemStack stack = player.getEquippedStack(slot);
        boolean warned = switch (flag) {
            case "armorWarned_head" -> armorWarned_head;
            case "armorWarned_chest" -> armorWarned_chest;
            case "armorWarned_legs" -> armorWarned_legs;
            default -> armorWarned_feet;
        };

        if (stack.isEmpty() || !stack.isDamageable()) {
            // Reset warning when armor removed/replaced
            setArmorWarned(flag, false);
            return;
        }

        int remaining = stack.getMaxDamage() - stack.getDamage();
        if (remaining <= DURABILITY_USES_WARN && remaining > 0 && !warned) {
            setArmorWarned(flag, true);
            DynamicIslandMod.triggerNotification(stack.getName().getString() + ": " + remaining + " uses left!", "durability");
        } else if (remaining > DURABILITY_USES_WARN) {
            setArmorWarned(flag, false);
        }
    }

    private static void setArmorWarned(String flag, boolean val) {
        switch (flag) {
            case "armorWarned_head" -> armorWarned_head = val;
            case "armorWarned_chest" -> armorWarned_chest = val;
            case "armorWarned_legs" -> armorWarned_legs = val;
            default -> armorWarned_feet = val;
        }
    }

    // ══════════════════════════════════════════════════
    // ONE-SHOT NOTIFICATIONS
    // ══════════════════════════════════════════════════

    private static void checkDeath(ClientPlayerEntity player) {
        if (player.isDead() && !wasDead) {
            deathPos = player.getBlockPos();
            deathDimension = getDimensionName(player);
            deathActive = true;
            wasDead = true;
            lastHealth = 20f;
        } else if (!player.isDead() && wasDead) {
            wasDead = false;
            lastHealth = player.getHealth();
        }
    }

    private static void checkHealth(ClientPlayerEntity player) {
        float health = player.getHealth();
        if (health <= HEALTH_THRESHOLD && health > 0 && health < lastHealth && DynamicIslandMod.toggleLowHealth) {
            DynamicIslandMod.triggerNotification("Low Health! " + String.format("%.0f", health / 2) + " hearts", "health");
        }
        lastHealth = health;
    }

    private static void checkHunger(ClientPlayerEntity player) {
        int food = player.getHungerManager().getFoodLevel();
        if (food <= HUNGER_THRESHOLD && !lowHungerShown && DynamicIslandMod.toggleLowHunger) {
            lowHungerShown = true;
            DynamicIslandMod.triggerNotification("Low Hunger! " + food / 2 + " left", "hunger");
        } else if (food > HUNGER_THRESHOLD + 2) {
            lowHungerShown = false;
        }
    }

    private static void checkInventoryFull(ClientPlayerEntity player) {
        boolean full = true;
        for (int i = 0; i < player.getInventory().main.size(); i++) {
            if (player.getInventory().main.get(i).isEmpty()) { full = false; break; }
        }
        if (full && !inventoryFullShown && DynamicIslandMod.toggleInventoryFull) {
            inventoryFullShown = true;
            DynamicIslandMod.triggerNotification("Inventory Full!", "inventory");
        } else if (!full) {
            inventoryFullShown = false;
        }
    }

    private static void checkDeathProximity(ClientPlayerEntity player) {
        if (!deathActive || deathPos == null || player.isDead()) return;
        String currentDim = getDimensionName(player);
        if (!currentDim.equals(deathDimension)) return; // Wrong dimension

        double dist = Math.sqrt(player.getBlockPos().getSquaredDistance(deathPos));
        if (dist < 5) {
            deathActive = false;
            DynamicIslandMod.triggerNotification("Reached death location!", "death");
        }
    }

    private static void checkBiomeChange(ClientPlayerEntity player) {
        String biome = player.getWorld().getBiome(player.getBlockPos())
                .getKey().map(k -> k.getValue().getPath()).orElse("unknown");
        String clean = biome.replace("_", " ");
        clean = clean.substring(0, 1).toUpperCase() + clean.substring(1);

        if (lastBiome == null) { lastBiome = clean; return; }
        if (!clean.equals(lastBiome)) {
            lastBiome = clean;
            // Set as subtitle footnote for 4 seconds (no notification sound)
            biomeSubtitle = clean;
            biomeSubtitleUntil = System.currentTimeMillis() + 4000;
        }
    }

    /** Returns true if biome subtitle should be shown */
    public static boolean hasBiomeSubtitle() {
        if (biomeSubtitle == null) return false;
        if (System.currentTimeMillis() > biomeSubtitleUntil) {
            biomeSubtitle = null;
            return false;
        }
        return true;
    }

    /** Returns true if a player head should be shown with current notification */
    public static boolean hasNotificationHead() {
        return notificationHeadTexture != null && System.currentTimeMillis() < notificationHeadUntil;
    }

    // ══════════════════════════════════════════════════
    // PLAYER PROXIMITY
    // ══════════════════════════════════════════════════

    private static void checkNearbyPlayers(MinecraftClient client) {
        if (client.world == null || client.player == null) return;

        List<AbstractClientPlayerEntity> players = client.world.getPlayers();

        // First tick: silently populate the set with all current players
        if (!playersInitialized) {
            for (AbstractClientPlayerEntity p : players) {
                knownPlayers.add(p.getUuid());
            }
            playersInitialized = true;
            return;
        }

        // Track current UUIDs to remove departed players
        Set<UUID> currentUuids = new HashSet<>();

        for (AbstractClientPlayerEntity p : players) {
            UUID uuid = p.getUuid();
            currentUuids.add(uuid);

            // Skip self
            if (uuid.equals(client.player.getUuid())) continue;

            // New player detected!
            if (!knownPlayers.contains(uuid)) {
                knownPlayers.add(uuid);
                String name = p.getName().getString();

                // Get their skin texture for the head icon
                PlayerListEntry entry = client.getNetworkHandler() != null
                        ? client.getNetworkHandler().getPlayerListEntry(uuid) : null;
                if (entry != null && entry.getSkinTextures() != null) {
                    notificationHeadTexture = entry.getSkinTextures().texture();
                    notificationHeadUntil = System.currentTimeMillis() + 4500; // Show head for notification duration
                }

                if (DynamicIslandMod.togglePlayerNearby) {
                    DynamicIslandMod.triggerNotification(name + " is nearby", "player");
                }
            }
        }

        // Remove players who left
        knownPlayers.retainAll(currentUuids);
        // Always keep self
        knownPlayers.add(client.player.getUuid());
    }

    // ══════════════════════════════════════════════════
    // DEATH LOCATION — Find My style
    // ══════════════════════════════════════════════════

    private static String getDeathDisplay(ClientPlayerEntity player) {
        if (deathPos == null) return null;

        String currentDim = getDimensionName(player);

        // Wrong dimension — guide to portal
        if (!currentDim.equals(deathDimension)) {
            return "Find a portal to " + deathDimension;
        }

        // Same dimension — show distance + direction
        double dx = deathPos.getX() - player.getX();
        double dz = deathPos.getZ() - player.getZ();
        int dist = (int) Math.sqrt(dx * dx + dz * dz);

        double angle = Math.toDegrees(Math.atan2(-dx, dz));
        float yaw = player.getYaw();
        double rel = ((angle - yaw) % 360 + 360) % 360;

        String dir;
        if (rel >= 337.5 || rel < 22.5)   dir = "ahead";
        else if (rel < 67.5)              dir = "ahead-right";
        else if (rel < 112.5)             dir = "to your right";
        else if (rel < 157.5)             dir = "behind-right";
        else if (rel < 202.5)             dir = "behind you";
        else if (rel < 247.5)             dir = "behind-left";
        else if (rel < 292.5)             dir = "to your left";
        else                              dir = "ahead-left";

        return dist + " blocks · " + dir;
    }

    public static String getDeathCoords() {
        if (deathPos == null) return "";
        return deathPos.getX() + " " + deathPos.getY() + " " + deathPos.getZ();
    }

    /** Returns true if song peek is active (new song during death tracking) */
    public static boolean isSongPeekActive() {
        return deathActive && songPeekUntil > 0 && System.currentTimeMillis() < songPeekUntil;
    }

    // ══════════════════════════════════════════════════
    // MC TIME
    // ══════════════════════════════════════════════════

    public static String getMcTimeDisplay() {
        MinecraftClient client = MinecraftClient.getInstance();
        if (client.world == null) return null;
        long time = client.world.getTimeOfDay();
        long day = time / 24000 + 1;
        long dayTime = time % 24000;
        String icon = dayTime < 12000 ? "Day" : dayTime < 13000 ? "Dusk" : dayTime < 23000 ? "Night" : "Dawn";
        return "Day " + day + " · " + icon;
    }

    private static String getDimensionName(ClientPlayerEntity player) {
        String dim = player.getWorld().getRegistryKey().getValue().getPath();
        if (dim.contains("nether")) return "Nether";
        if (dim.contains("end")) return "The End";
        return "Overworld";
    }
}
