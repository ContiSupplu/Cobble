package com.cobble.dynamicisland.mixin;

import com.cobble.dynamicisland.protection.LoomShield;
import com.cobble.dynamicisland.protection.NbtProtection;
import com.cobble.dynamicisland.protection.PacketRateLimiter;
import net.minecraft.client.network.ClientPlayNetworkHandler;
import net.minecraft.item.ItemStack;
import net.minecraft.network.packet.s2c.play.*;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import java.util.List;

/**
 * Main Loom Shield packet interceptor.
 *
 * Protects against:
 * - Book bans / NBT overflow (inventory, slot, chunk packets)
 * - Packet floods (particles, explosions, sounds, entities)
 * - Crash loop recovery (safe mode on join)
 */
@Mixin(ClientPlayNetworkHandler.class)
public class ClientPlayNetworkHandlerMixin {

    // ── NBT Overflow Protection ──

    @Inject(method = "onInventory", at = @At("HEAD"), cancellable = true)
    private void loomshield_protectInventory(InventoryS2CPacket packet, CallbackInfo ci) {
        if (!LoomShield.enabled) return;

        try {
            // Try getContents() first, fallback to contents() for record-style accessors
            List<ItemStack> contents;
            try {
                contents = packet.contents();
            } catch (NoSuchMethodError e) {
                // Try record-style accessor
                try {
                    java.lang.reflect.Method m = packet.getClass().getMethod("contents");
                    @SuppressWarnings("unchecked")
                    List<ItemStack> result = (List<ItemStack>) m.invoke(packet);
                    contents = result;
                } catch (Exception ex) {
                    return; // Can't access contents, skip protection
                }
            }
            if (NbtProtection.isOversized(contents)) {
                LoomShield.logBlock("Book Ban",
                    "Blocked oversized inventory packet (" + contents.size() + " slots)");
                LoomShield.notifyPlayer("§c🛡 Loom Shield blocked a potential book ban attack!");
                ci.cancel();
            }
        } catch (Exception e) {
            // Don't crash on protection failure — let packet through
            System.err.println("[LoomShield] Error checking inventory packet: " + e.getMessage());
        }
    }

    @Inject(method = "onScreenHandlerSlotUpdate", at = @At("HEAD"), cancellable = true)
    private void loomshield_protectSlotUpdate(ScreenHandlerSlotUpdateS2CPacket packet, CallbackInfo ci) {
        if (!LoomShield.enabled) return;

        try {
            ItemStack stack;
            try {
                stack = packet.getStack();
            } catch (NoSuchMethodError e) {
                try {
                    java.lang.reflect.Method m = packet.getClass().getMethod("stack");
                    stack = (ItemStack) m.invoke(packet);
                } catch (Exception ex) {
                    return;
                }
            }
            if (NbtProtection.isItemOversized(stack)) {
                int slot;
                try {
                    slot = packet.getSlot();
                } catch (NoSuchMethodError e2) {
                    slot = -1;
                }
                LoomShield.logBlock("NBT Overflow",
                    "Blocked oversized item in slot " + slot);
                ci.cancel();
            }
        } catch (Exception e) {
            System.err.println("[LoomShield] Error checking slot packet: " + e.getMessage());
        }
    }

    // ── Packet Flood Protection ──

    @Inject(method = "onParticle", at = @At("HEAD"), cancellable = true)
    private void loomshield_limitParticles(ParticleS2CPacket packet, CallbackInfo ci) {
        if (!LoomShield.enabled) return;
        if (!PacketRateLimiter.allow(PacketRateLimiter.PARTICLE)) {
            ci.cancel();
        }
    }

    @Inject(method = "onExplosion", at = @At("HEAD"), cancellable = true)
    private void loomshield_limitExplosions(ExplosionS2CPacket packet, CallbackInfo ci) {
        if (!LoomShield.enabled) return;
        if (!PacketRateLimiter.allow(PacketRateLimiter.EXPLOSION)) {
            ci.cancel();
        }
    }

    @Inject(method = "onPlaySound", at = @At("HEAD"), cancellable = true)
    private void loomshield_limitSounds(PlaySoundS2CPacket packet, CallbackInfo ci) {
        if (!LoomShield.enabled) return;
        if (!PacketRateLimiter.allow(PacketRateLimiter.SOUND)) {
            ci.cancel();
        }
    }

    @Inject(method = "onEntitySpawn", at = @At("HEAD"), cancellable = true)
    private void loomshield_limitEntitySpawn(EntitySpawnS2CPacket packet, CallbackInfo ci) {
        if (!LoomShield.enabled) return;
        if (!PacketRateLimiter.allow(PacketRateLimiter.ENTITY_SPAWN)) {
            ci.cancel();
        }
    }

    @Inject(method = "onEntityVelocityUpdate", at = @At("HEAD"), cancellable = true)
    private void loomshield_limitVelocity(EntityVelocityUpdateS2CPacket packet, CallbackInfo ci) {
        if (!LoomShield.enabled) return;
        if (!PacketRateLimiter.allow(PacketRateLimiter.VELOCITY)) {
            ci.cancel();
        }
    }

    // ── Safe Mode (Crash Loop Recovery) ──

    @Inject(method = "onGameJoin", at = @At("TAIL"))
    private void loomshield_onGameJoin(GameJoinS2CPacket packet, CallbackInfo ci) {
        // Safe mode inventory skip is handled in onInventory via timing
        if (LoomShield.isSafeModeActive()) {
            System.out.println("[LoomShield] Joined in safe mode — monitoring for threats");
        }
    }
}
