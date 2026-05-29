package com.cobble.dynamicisland;

import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.event.player.AttackEntityCallback;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.AbstractClientPlayerEntity;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.entity.EquipmentSlot;
import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.item.*;
import net.minecraft.util.ActionResult;
import net.minecraft.util.Identifier;

import java.util.ArrayList;
import java.util.List;

/**
 * Tracks combat state: detects when player is attacked OR attacks another player.
 * Shows opponent info including armor pieces with durability, weapon, health, potion effects.
 * 20-second timeout, resets on each hit in either direction.
 * Kill celebration when opponent dies during combat.
 */
public class CombatTracker {

    private static final long COMBAT_TIMEOUT_MS = 20000; // 20 seconds
    private static final double MAX_COMBAT_RANGE = 50.0;

    // Combat state
    public static boolean inCombat = false;
    public static long lastCombatTime = 0;
    public static LivingEntity opponent = null;
    public static String opponentName = null;
    public static float opponentHealth = 0;
    public static float opponentMaxHealth = 0;
    public static String opponentWeaponName = null;
    public static Identifier opponentSkinTexture = null;

    // Individual armor pieces
    public static ItemStack opponentHelmet = ItemStack.EMPTY;
    public static ItemStack opponentChestplate = ItemStack.EMPTY;
    public static ItemStack opponentLeggings = ItemStack.EMPTY;
    public static ItemStack opponentBoots = ItemStack.EMPTY;
    public static ItemStack opponentWeaponStack = ItemStack.EMPTY;
    public static ItemStack opponentOffhand = ItemStack.EMPTY;

    // Potion effects
    public static List<String> opponentEffects = new ArrayList<>();

    // Kill celebration
    public static boolean killCelebration = false;
    public static long killCelebrationTime = 0;
    public static String killedPlayerName = null;
    private static final long CELEBRATION_DURATION_MS = 3000;

    public static void register() {
        // Tick-based combat tracking
        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            if (client.player == null || client.world == null) return;
            tick(client);
        });

        // Melee attack detection (player attacking others)
        AttackEntityCallback.EVENT.register((player, world, hand, entity, hitResult) -> {
            if (world.isClient() && entity instanceof LivingEntity living) {
                if (living instanceof AbstractClientPlayerEntity) {
                    enterCombat(living);
                }
            }
            return ActionResult.PASS;
        });
    }

    private static void tick(MinecraftClient client) {
        ClientPlayerEntity player = client.player;
        if (player == null) return;

        // --- Kill celebration timeout ---
        if (killCelebration) {
            if (System.currentTimeMillis() - killCelebrationTime > CELEBRATION_DURATION_MS) {
                killCelebration = false;
                killedPlayerName = null;
                endCombat();
            }
            return;
        }

        // --- Detect being hit ---
        if (player.hurtTime > 0) {
            LivingEntity attacker = player.getAttacker();

            // Fallback: scan nearby players when getAttacker() returns null
            if (attacker == null || !attacker.isAlive()) {
                attacker = findLikelyAttacker(client, player);
            }

            if (attacker != null && attacker.isAlive()) {
                if (isHoldingWeapon(attacker) || player.distanceTo(attacker) <= 6.0) {
                    enterCombat(attacker);
                }
            }
        }

        // --- Detect bow/ranged hits (player hitting others with bow) ---
        Item heldItem = player.getMainHandStack().getItem();
        boolean holdingRanged = heldItem instanceof BowItem || heldItem instanceof CrossbowItem;
        if (holdingRanged) {
            for (AbstractClientPlayerEntity other : client.world.getPlayers()) {
                if (other == player) continue;
                if (!other.isAlive()) continue;
                // Just got hit (first frame of hurt animation)
                if (other.hurtTime >= 9 && player.distanceTo(other) <= MAX_COMBAT_RANGE) {
                    enterCombat(other);
                }
            }
        }

        // --- Also detect being hit by arrows (opponent might be far away with bow) ---
        if (player.hurtTime > 0) {
            for (AbstractClientPlayerEntity other : client.world.getPlayers()) {
                if (other == player) continue;
                if (!other.isAlive()) continue;
                Item otherHeld = other.getMainHandStack().getItem();
                if ((otherHeld instanceof BowItem || otherHeld instanceof CrossbowItem)
                    && player.distanceTo(other) <= MAX_COMBAT_RANGE) {
                    enterCombat(other);
                    break;
                }
            }
        }

        // --- Update ongoing combat ---
        if (inCombat && opponent != null) {
            if (!opponent.isAlive()) {
                triggerKillCelebration();
                return;
            }

            if (player.distanceTo(opponent) > MAX_COMBAT_RANGE) {
                endCombat();
                return;
            }

            if (System.currentTimeMillis() - lastCombatTime > COMBAT_TIMEOUT_MS) {
                endCombat();
                return;
            }

            updateOpponentStats();
        }
    }

    private static void updateOpponentStats() {
        if (opponent == null) return;
        opponentHealth = opponent.getHealth();
        opponentMaxHealth = opponent.getMaxHealth();
        opponentWeaponName = opponent.getMainHandStack().getName().getString();
        opponentWeaponStack = opponent.getMainHandStack().copy();
        opponentOffhand = opponent.getOffHandStack().copy();

        // Armor pieces
        opponentHelmet = opponent.getEquippedStack(EquipmentSlot.HEAD).copy();
        opponentChestplate = opponent.getEquippedStack(EquipmentSlot.CHEST).copy();
        opponentLeggings = opponent.getEquippedStack(EquipmentSlot.LEGS).copy();
        opponentBoots = opponent.getEquippedStack(EquipmentSlot.FEET).copy();

        // Skin texture
        if (opponent instanceof AbstractClientPlayerEntity playerOpponent) {
            opponentSkinTexture = playerOpponent.getSkin().body().texturePath();
        }

        // Potion effects — try direct API first
        opponentEffects.clear();
        try {
            for (StatusEffectInstance effect : opponent.getStatusEffects()) {
                String key = effect.getEffectType().getIdAsString();
                String name = key.contains(":") ? key.substring(key.indexOf(":") + 1) : key;
                name = name.replace("_", " ");
                if (!name.isEmpty()) {
                    name = name.substring(0, 1).toUpperCase() + name.substring(1);
                }

                int durationTicks = effect.getDuration();
                if (durationTicks > 0 && durationTicks < 999999) {
                    int totalSec = durationTicks / 20;
                    int min = totalSec / 60;
                    int sec = totalSec % 60;
                    name += " " + min + ":" + String.format("%02d", sec);
                }

                int amplifier = effect.getAmplifier();
                if (amplifier > 0) {
                    name += " " + toRoman(amplifier + 1);
                }

                opponentEffects.add(name);
            }
        } catch (Exception e) {
            // Silently fail if API isn't available
        }

        // Fallback: detect visible states if no effects found
        if (opponentEffects.isEmpty()) {
            if (opponent.isInvisible()) opponentEffects.add("Invisible");
            if (opponent.isGlowing()) opponentEffects.add("Glowing");
            if (opponent.isOnFire()) opponentEffects.add("On Fire");
            if (opponent.isSprinting()) opponentEffects.add("Sprinting");
            if (opponent.isFrozen()) opponentEffects.add("Frozen");
        }
    }

    private static String toRoman(int num) {
        if (num == 2) return "II";
        if (num == 3) return "III";
        if (num == 4) return "IV";
        if (num == 5) return "V";
        return String.valueOf(num);
    }

    private static boolean isHoldingWeapon(LivingEntity entity) {
        ItemStack heldStack = entity.getMainHandStack();
        if (heldStack.isEmpty()) return false;

        Item item = heldStack.getItem();
        return item instanceof AxeItem
            || item instanceof BowItem
            || item instanceof CrossbowItem
            || item instanceof TridentItem
            || item instanceof MaceItem
            || heldStack.isDamageable();  // broad fallback for weapons including swords
    }

    private static LivingEntity findLikelyAttacker(MinecraftClient client, ClientPlayerEntity player) {
        if (client.world == null) return null;

        LivingEntity best = null;
        double bestDist = 16.0;
        boolean bestHasWeapon = false;

        for (AbstractClientPlayerEntity other : client.world.getPlayers()) {
            if (other == player) continue;
            if (!other.isAlive()) continue;

            double dist = player.distanceTo(other);
            if (dist > bestDist && best != null) continue;

            boolean hasWeapon = isHoldingWeapon(other);

            if (best == null
                || (hasWeapon && !bestHasWeapon)
                || (hasWeapon == bestHasWeapon && dist < bestDist)) {
                best = other;
                bestDist = dist;
                bestHasWeapon = hasWeapon;
            }
        }

        return best;
    }

    public static void enterCombat(LivingEntity attacker) {
        boolean newOpponent = (opponent == null || !attacker.equals(opponent));

        opponent = attacker;
        opponentName = attacker.getName().getString();
        lastCombatTime = System.currentTimeMillis();

        updateOpponentStats();

        if (attacker instanceof AbstractClientPlayerEntity playerAttacker) {
            opponentSkinTexture = playerAttacker.getSkin().body().texturePath();
        } else {
            opponentSkinTexture = null;
        }

        if (!inCombat || newOpponent) {
            inCombat = true;
            DynamicIslandMod.triggerSilentNotification(
                "Combat: " + opponentName, "combat"
            );
        }
    }

    private static void triggerKillCelebration() {
        killCelebration = true;
        killCelebrationTime = System.currentTimeMillis();
        killedPlayerName = opponentName != null ? opponentName : "Unknown";
        DynamicIslandMod.triggerSilentNotification(
            "✦ Eliminated " + killedPlayerName + "!", "combat"
        );
    }

    public static boolean isInCombat() {
        if (killCelebration) return true;
        if (!inCombat) return false;
        if (System.currentTimeMillis() - lastCombatTime > COMBAT_TIMEOUT_MS) {
            endCombat();
            return false;
        }
        return true;
    }

    public static boolean isCelebrating() {
        return killCelebration;
    }

    public static void endCombat() {
        inCombat = false;
        opponent = null;
        opponentName = null;
        opponentHealth = 0;
        opponentMaxHealth = 0;
        opponentWeaponName = null;
        opponentSkinTexture = null;
        opponentHelmet = ItemStack.EMPTY;
        opponentChestplate = ItemStack.EMPTY;
        opponentLeggings = ItemStack.EMPTY;
        opponentBoots = ItemStack.EMPTY;
        opponentWeaponStack = ItemStack.EMPTY;
        opponentOffhand = ItemStack.EMPTY;
        opponentEffects.clear();
    }
}
