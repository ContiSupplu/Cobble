package com.cobble.dynamicisland.protection;

import net.minecraft.item.ItemStack;
import net.minecraft.nbt.NbtCompound;
import net.minecraft.nbt.NbtElement;
import net.minecraft.nbt.NbtList;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.util.List;

/**
 * NBT/Component overflow protection.
 * Estimates the serialized size of ItemStacks to detect weaponized NBT data
 * (book bans, shulker box exploits, etc.)
 * 
 * Threshold: 1,777,777 bytes (~1.7 MB) — aligned with AntiNbtKick.
 * Normal items are 1-50 KB. Only weaponized data exceeds this.
 */
public class NbtProtection {

    // Max allowed serialized size for a single packet's worth of items
    public static final long MAX_PACKET_NBT_BYTES = 1_777_777L;
    
    // Max allowed for a single ItemStack
    public static final long MAX_ITEM_NBT_BYTES = 500_000L;

    /**
     * Estimate the serialized byte size of an ItemStack's NBT/component data.
     * Uses a fast estimation rather than full serialization for performance.
     */
    public static long estimateItemSize(ItemStack stack) {
        if (stack == null || stack.isEmpty()) return 0;

        try {
            // In 1.21.11, use toNbt() or encode via RegistryOps
            // Fallback: estimate from components directly
            net.minecraft.registry.RegistryOps<NbtElement> ops = net.minecraft.registry.RegistryOps.of(
                net.minecraft.nbt.NbtOps.INSTANCE, 
                net.minecraft.client.MinecraftClient.getInstance().world.getRegistryManager()
            );
            NbtCompound nbt = (NbtCompound) ItemStack.CODEC.encodeStart(ops, stack).getOrThrow();
            if (nbt == null) return 0;
            return estimateNbtSize(nbt);
        } catch (Exception e) {
            // If we can't estimate, assume it's safe
            return 0;
        }
    }

    /**
     * Recursively estimate the byte size of an NBT element.
     */
    public static long estimateNbtSize(NbtElement element) {
        if (element == null) return 0;
        
        long size = 1; // Tag type byte

        switch (element.getType()) {
            case NbtElement.COMPOUND_TYPE: {
                NbtCompound compound = (NbtCompound) element;
                for (String key : compound.getKeys()) {
                    size += 2 + key.length(); // Key length (2 bytes) + key string
                    size += estimateNbtSize(compound.get(key));
                }
                size += 1; // End tag
                break;
            }
            case NbtElement.LIST_TYPE: {
                NbtList list = (NbtList) element;
                size += 5; // Type byte + length int
                for (int i = 0; i < list.size(); i++) {
                    size += estimateNbtSize(list.get(i));
                }
                break;
            }
            case NbtElement.STRING_TYPE:
                // In 1.21.11, asString() may return Optional<String>; handle both cases
                size += 2 + getStringLength(element) * 2; // Modified UTF-8 worst case
                break;
            case NbtElement.BYTE_ARRAY_TYPE:
                size += 4 + ((net.minecraft.nbt.NbtByteArray) element).getByteArray().length;
                break;
            case NbtElement.INT_ARRAY_TYPE:
                size += 4 + ((net.minecraft.nbt.NbtIntArray) element).getIntArray().length * 4;
                break;
            case NbtElement.LONG_ARRAY_TYPE:
                size += 4 + ((net.minecraft.nbt.NbtLongArray) element).getLongArray().length * 8;
                break;
            case NbtElement.BYTE_TYPE:
                size += 1;
                break;
            case NbtElement.SHORT_TYPE:
                size += 2;
                break;
            case NbtElement.INT_TYPE:
                size += 4;
                break;
            case NbtElement.LONG_TYPE:
                size += 8;
                break;
            case NbtElement.FLOAT_TYPE:
                size += 4;
                break;
            case NbtElement.DOUBLE_TYPE:
                size += 8;
                break;
            default:
                size += 8; // Conservative estimate for unknown types
                break;
        }
        return size;
    }

    /**
     * Safely get string length from an NbtElement, handling both String return
     * and Optional<String> return for different MC versions.
     */
    private static int getStringLength(NbtElement element) {
        try {
            Object result = element.asString();
            if (result instanceof String s) {
                return s.length();
            } else if (result instanceof java.util.Optional<?> opt) {
                return opt.map(o -> o.toString().length()).orElse(0);
            }
            return element.toString().length();
        } catch (Exception e) {
            return element.toString().length();
        }
    }

    /**
     * Check a list of ItemStacks (e.g., from an inventory packet).
     * Returns true if the total size exceeds the safe threshold.
     */
    public static boolean isOversized(List<ItemStack> stacks) {
        long totalSize = 0;
        for (ItemStack stack : stacks) {
            totalSize += estimateItemSize(stack);
            if (totalSize > MAX_PACKET_NBT_BYTES) {
                return true; // Early exit
            }
        }
        return false;
    }

    /**
     * Check a single ItemStack.
     * Returns true if it exceeds the single-item threshold.
     */
    public static boolean isItemOversized(ItemStack stack) {
        return estimateItemSize(stack) > MAX_ITEM_NBT_BYTES;
    }
}
