package com.cobble.dynamicisland;

import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.fabricmc.fabric.api.client.screen.v1.ScreenMouseEvents;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.screen.ingame.CraftingScreen;
import net.minecraft.client.gui.screen.ingame.HandledScreen;
import net.minecraft.client.gui.screen.ingame.InventoryScreen;
import net.minecraft.client.gui.screen.ingame.GenericContainerScreen;
import net.minecraft.item.*;
import net.minecraft.registry.Registries;
import net.minecraft.screen.ScreenHandler;
import net.minecraft.screen.slot.Slot;
import net.minecraft.screen.slot.SlotActionType;

import java.util.*;

/**
 * Detects swipe gestures on inventory screens and performs actions:
 *   Swipe DOWN  → Sort inventory (consolidate + sort by category)
 *   Swipe UP    → Restore preset layout
 *   Swipe LEFT  → Quick-craft from recipe (remembers last recipe for repeat)
 *   Swipe RIGHT → Dump to chest (except tools/armor/elytra)
 */
public class GestureHandler {

    private static boolean tracking = false;
    private static double startX, startY;
    private static final int MIN_DRAG = 40;

    // Recipe memory
    private static Map<Integer, Integer> lastRecipePattern = null; // gridIndex -> item raw id
    private static int lastGridSize = 0;

    public static void register() {
        ScreenEvents.AFTER_INIT.register((client, screen, scaledWidth, scaledHeight) -> {
            if (!(screen instanceof HandledScreen<?>)) return;

            ScreenMouseEvents.beforeMouseClick(screen).register((s, mx, my, button) -> {
                if (button == 0) {
                    HandledScreen<?> hs = (HandledScreen<?>) s;
                    int guiLeft = (hs.width - 176) / 2;
                    int guiRight = guiLeft + 176;
                    if (mx < guiLeft || mx > guiRight) {
                        tracking = true;
                        startX = mx;
                        startY = my;
                    }
                }
            });

            ScreenMouseEvents.beforeMouseRelease(screen).register((s, mx, my, button) -> {
                if (button == 0 && tracking) {
                    tracking = false;
                    double dx = mx - startX;
                    double dy = my - startY;
                    double absDx = Math.abs(dx);
                    double absDy = Math.abs(dy);
                    if (absDx < MIN_DRAG && absDy < MIN_DRAG) return;

                    if (absDy > absDx) {
                        if (dy > 0) onSwipeDown(client);
                        else onSwipeUp(client);
                    } else {
                        if (dx > 0) onSwipeRight(client);
                        else onSwipeLeft(client);
                    }
                }
            });
        });
    }

    // ══════════════════════════════════════════════════
    // HELPERS
    // ══════════════════════════════════════════════════

    private static List<Slot> getPlayerMainSlots(ScreenHandler handler, MinecraftClient client) {
        List<Slot> result = new ArrayList<>();
        for (Slot slot : handler.slots) {
            if (slot.inventory == client.player.getInventory()
                    && slot.getIndex() >= 0 && slot.getIndex() <= 35) {
                result.add(slot);
            }
        }
        return result;
    }

    private static void click(MinecraftClient client, int syncId, int slotId) {
        client.interactionManager.clickSlot(syncId, slotId, 0, SlotActionType.PICKUP, client.player);
    }

    private static void rightClick(MinecraftClient client, int syncId, int slotId) {
        client.interactionManager.clickSlot(syncId, slotId, 1, SlotActionType.PICKUP, client.player);
    }

    private static void shiftClick(MinecraftClient client, int syncId, int slotId) {
        client.interactionManager.clickSlot(syncId, slotId, 0, SlotActionType.QUICK_MOVE, client.player);
    }

    private static boolean sameItemType(ItemStack a, ItemStack b) {
        if (a.isEmpty() || b.isEmpty()) return false;
        return Registries.ITEM.getRawId(a.getItem()) == Registries.ITEM.getRawId(b.getItem());
    }

    // ══════════════════════════════════════════════════
    // SWIPE DOWN → Sort Inventory
    // ══════════════════════════════════════════════════
    private static void onSwipeDown(MinecraftClient client) {
        if (client.player == null || client.interactionManager == null) return;
        Screen screen = client.currentScreen;
        if (!(screen instanceof HandledScreen<?> hs)) return;

        ScreenHandler handler = hs.getScreenHandler();
        int syncId = handler.syncId;
        List<Slot> slots = getPlayerMainSlots(handler, client);
        int n = slots.size();
        if (n == 0) return;

        // ── Step 1: Consolidate same-item stacks ──
        for (int i = 0; i < n; i++) {
            if (!slots.get(i).hasStack()) continue;
            for (int j = i + 1; j < n; j++) {
                if (!slots.get(j).hasStack()) continue;
                if (sameItemType(slots.get(i).getStack(), slots.get(j).getStack())) {
                    int space = slots.get(i).getStack().getMaxCount() - slots.get(i).getStack().getCount();
                    if (space > 0) {
                        // Pick up j, click on i to combine, put remainder back at j
                        click(client, syncId, slots.get(j).id);
                        click(client, syncId, slots.get(i).id);
                        click(client, syncId, slots.get(j).id);
                    }
                }
            }
        }

        // ── Step 2: Compact (push empties to end) ──
        for (int i = 0; i < n; i++) {
            if (!slots.get(i).hasStack()) {
                for (int j = i + 1; j < n; j++) {
                    if (slots.get(j).hasStack()) {
                        click(client, syncId, slots.get(j).id);
                        click(client, syncId, slots.get(i).id);
                        break;
                    }
                }
            }
        }

        // ── Step 3: Count non-empty items ──
        int itemCount = 0;
        for (int i = 0; i < n; i++) {
            if (slots.get(i).hasStack()) itemCount++;
            else break;
        }

        if (itemCount <= 1) {
            DynamicIslandMod.triggerSilentNotification("Inventory sorted!", "general");
            return;
        }

        // ── Step 4: Selection sort using buffer slot ──
        for (int i = 0; i < itemCount - 1; i++) {
            int minIdx = i;
            for (int j = i + 1; j < itemCount; j++) {
                if (compareStacks(slots.get(j).getStack(), slots.get(minIdx).getStack()) < 0) {
                    minIdx = j;
                }
            }
            if (minIdx == i) continue;

            // Skip swap if same item type (they're already considered equal in sort order)
            if (sameItemType(slots.get(i).getStack(), slots.get(minIdx).getStack())) continue;

            // Swap using empty buffer slot at end
            int bufferIdx = itemCount; // first empty slot after items
            if (bufferIdx < n) {
                click(client, syncId, slots.get(i).id);        // pick up from i
                click(client, syncId, slots.get(bufferIdx).id); // place at buffer
                click(client, syncId, slots.get(minIdx).id);    // pick up from minIdx
                click(client, syncId, slots.get(i).id);         // place at i
                click(client, syncId, slots.get(bufferIdx).id); // pick up from buffer
                click(client, syncId, slots.get(minIdx).id);    // place at minIdx
            } else {
                // No buffer — direct swap (only safe for different item types, which we checked)
                click(client, syncId, slots.get(i).id);
                click(client, syncId, slots.get(minIdx).id);
                click(client, syncId, slots.get(i).id);
            }
        }

        DynamicIslandMod.triggerSilentNotification("Inventory sorted!", "general");
    }

    private static int compareStacks(ItemStack a, ItemStack b) {
        boolean ea = a.isEmpty(), eb = b.isEmpty();
        if (ea && eb) return 0;
        if (ea) return 1;
        if (eb) return -1;
        int ca = getCategoryOrder(a), cb = getCategoryOrder(b);
        if (ca != cb) return ca - cb;
        return a.getName().getString().compareTo(b.getName().getString());
    }

    // ══════════════════════════════════════════════════
    // SWIPE UP → Restore Preset Layout
    // ══════════════════════════════════════════════════
    private static void onSwipeUp(MinecraftClient client) {
        if (!DynamicIslandMod.hasInventoryPreset || DynamicIslandMod.savedInventoryLayout == null) {
            DynamicIslandMod.triggerSilentNotification("No preset saved! G > Inventory", "general");
            return;
        }
        if (client.player == null || client.interactionManager == null) return;
        Screen screen = client.currentScreen;
        if (!(screen instanceof HandledScreen<?> hs)) return;

        ScreenHandler handler = hs.getScreenHandler();
        int syncId = handler.syncId;
        List<Slot> slots = getPlayerMainSlots(handler, client);
        int[] preset = DynamicIslandMod.savedInventoryLayout;

        // For each slot in the preset, ensure the right item type is there
        for (int i = 0; i < Math.min(preset.length, slots.size()); i++) {
            int wantedId = preset[i];
            if (wantedId == -1) continue; // preset says empty

            Slot targetSlot = slots.get(i);

            // Check if already correct
            if (targetSlot.hasStack()) {
                int currentId = Registries.ITEM.getRawId(targetSlot.getStack().getItem());
                if (currentId == wantedId) continue;
            }

            // Search ALL other slots for this item type (not just j > i)
            int sourceIdx = -1;
            for (int j = 0; j < slots.size(); j++) {
                if (j == i) continue;
                if (slots.get(j).hasStack()) {
                    int srcId = Registries.ITEM.getRawId(slots.get(j).getStack().getItem());
                    if (srcId == wantedId) { sourceIdx = j; break; }
                }
            }
            if (sourceIdx == -1) continue; // item not found anywhere

            if (!targetSlot.hasStack()) {
                // Target is empty — just move source here
                click(client, syncId, slots.get(sourceIdx).id);
                click(client, syncId, targetSlot.id);
            } else {
                // Target has wrong item — need to swap
                // Find an empty slot for buffer
                int emptyIdx = -1;
                for (int e = 0; e < slots.size(); e++) {
                    if (!slots.get(e).hasStack()) { emptyIdx = e; break; }
                }
                if (emptyIdx != -1) {
                    // Move wrong item to buffer
                    click(client, syncId, targetSlot.id);
                    click(client, syncId, slots.get(emptyIdx).id);
                    // Move correct item to target
                    click(client, syncId, slots.get(sourceIdx).id);
                    click(client, syncId, targetSlot.id);
                } else {
                    // No buffer — direct swap (works for different types)
                    click(client, syncId, slots.get(sourceIdx).id);
                    click(client, syncId, targetSlot.id);
                    click(client, syncId, slots.get(sourceIdx).id);
                }
            }
        }

        DynamicIslandMod.triggerSilentNotification("Preset layout restored!", "general");
    }

    // ══════════════════════════════════════════════════
    // SWIPE LEFT → Quick Craft (with recipe memory)
    // ══════════════════════════════════════════════════
    private static void onSwipeLeft(MinecraftClient client) {
        if (client.player == null || client.interactionManager == null) return;
        Screen screen = client.currentScreen;
        if (!(screen instanceof HandledScreen<?> hs)) return;

        ScreenHandler handler = hs.getScreenHandler();
        int syncId = handler.syncId;

        int resultSlotId;
        List<Integer> gridSlotIds = new ArrayList<>();
        int gridSize;

        if (screen instanceof CraftingScreen) {
            resultSlotId = 0;
            for (int i = 1; i <= 9; i++) gridSlotIds.add(i);
            gridSize = 9;
        } else if (screen instanceof InventoryScreen) {
            resultSlotId = 0;
            for (int i = 1; i <= 4; i++) gridSlotIds.add(i);
            gridSize = 4;
        } else {
            DynamicIslandMod.triggerSilentNotification("Open crafting to quick-craft!", "general");
            return;
        }

        // Check if grid is empty
        boolean gridEmpty = true;
        for (int slotId : gridSlotIds) {
            if (handler.getSlot(slotId).hasStack()) { gridEmpty = false; break; }
        }

        // If grid is empty but we have a stored recipe, fill grid AND craft in one go
        if (gridEmpty && lastRecipePattern != null && lastGridSize == gridSize) {
            craftFromMemory(client, handler, syncId, resultSlotId, gridSlotIds);
            return;
        }

        // Grid has a recipe — read it, save it, craft
        Map<Integer, Integer> recipePattern = new LinkedHashMap<>();
        Map<Integer, Integer> recipeCost = new HashMap<>();
        boolean hasRecipe = false;

        for (int idx = 0; idx < gridSlotIds.size(); idx++) {
            Slot gridSlot = handler.getSlot(gridSlotIds.get(idx));
            if (gridSlot.hasStack()) {
                hasRecipe = true;
                int rawId = Registries.ITEM.getRawId(gridSlot.getStack().getItem());
                recipePattern.put(idx, rawId);
                recipeCost.merge(rawId, 1, Integer::sum);
            }
        }

        if (!hasRecipe) {
            DynamicIslandMod.triggerSilentNotification("Place a recipe in the grid first!", "general");
            return;
        }

        Slot resultSlot = handler.getSlot(resultSlotId);
        if (!resultSlot.hasStack()) {
            DynamicIslandMod.triggerSilentNotification("Invalid recipe!", "general");
            return;
        }

        // Save recipe for memory
        lastRecipePattern = new LinkedHashMap<>(recipePattern);
        lastGridSize = gridSize;

        // Mass craft
        int crafted = massCraft(client, handler, syncId, resultSlotId, gridSlotIds, recipePattern, recipeCost);

        String resultName = resultSlot.hasStack() ? resultSlot.getStack().getName().getString() : "items";
        DynamicIslandMod.triggerSilentNotification("Crafted " + crafted + "x " + resultName, "general");
    }

    /**
     * Fill grid from memory recipe and mass-craft — all in one swipe.
     */
    private static void craftFromMemory(MinecraftClient client, ScreenHandler handler, int syncId,
                                         int resultSlotId, List<Integer> gridSlotIds) {
        List<Slot> playerSlots = getPlayerMainSlots(handler, client);
        Map<Integer, Integer> recipePattern = lastRecipePattern;
        Map<Integer, Integer> recipeCost = new HashMap<>();
        for (Map.Entry<Integer, Integer> entry : recipePattern.entrySet()) {
            recipeCost.merge(entry.getValue(), 1, Integer::sum);
        }

        // Count available materials
        Map<Integer, Integer> available = new HashMap<>();
        for (Slot slot : playerSlots) {
            if (slot.hasStack()) {
                int rawId = Registries.ITEM.getRawId(slot.getStack().getItem());
                available.merge(rawId, slot.getStack().getCount(), Integer::sum);
            }
        }

        // Check if we have enough for at least 1 craft
        int maxCrafts = Integer.MAX_VALUE;
        for (Map.Entry<Integer, Integer> entry : recipeCost.entrySet()) {
            int have = available.getOrDefault(entry.getKey(), 0);
            if (have < entry.getValue()) {
                DynamicIslandMod.triggerSilentNotification("Not enough materials!", "general");
                return;
            }
            maxCrafts = Math.min(maxCrafts, have / entry.getValue());
        }

        // Fill the grid for first craft
        for (Map.Entry<Integer, Integer> entry : recipePattern.entrySet()) {
            int gridIdx = entry.getKey();
            int itemId = entry.getValue();
            int slotId = gridSlotIds.get(gridIdx);

            for (Slot pSlot : playerSlots) {
                if (pSlot.hasStack() && Registries.ITEM.getRawId(pSlot.getStack().getItem()) == itemId) {
                    click(client, syncId, pSlot.id);                        // pick up stack
                    rightClick(client, syncId, slotId);                      // place 1 in grid
                    click(client, syncId, pSlot.id);                        // put rest back
                    break;
                }
            }
        }

        // Now mass-craft (grid is filled, result should appear)
        int crafted = massCraft(client, handler, syncId, resultSlotId, gridSlotIds, recipePattern, recipeCost);

        DynamicIslandMod.triggerSilentNotification("Crafted " + crafted + "x from memory", "general");
    }

    /**
     * Mass-craft: take result, refill grid, repeat until out of materials or space.
     */
    private static int massCraft(MinecraftClient client, ScreenHandler handler, int syncId,
                                  int resultSlotId, List<Integer> gridSlotIds,
                                  Map<Integer, Integer> recipePattern, Map<Integer, Integer> recipeCost) {
        List<Slot> playerSlots = getPlayerMainSlots(handler, client);

        // Count all available materials (inventory + grid)
        Map<Integer, Integer> available = new HashMap<>();
        for (Slot slot : playerSlots) {
            if (slot.hasStack()) {
                available.merge(Registries.ITEM.getRawId(slot.getStack().getItem()), slot.getStack().getCount(), Integer::sum);
            }
        }
        for (int slotId : gridSlotIds) {
            Slot gridSlot = handler.getSlot(slotId);
            if (gridSlot.hasStack()) {
                available.merge(Registries.ITEM.getRawId(gridSlot.getStack().getItem()), gridSlot.getStack().getCount(), Integer::sum);
            }
        }

        int maxCrafts = Integer.MAX_VALUE;
        for (Map.Entry<Integer, Integer> entry : recipeCost.entrySet()) {
            int have = available.getOrDefault(entry.getKey(), 0);
            maxCrafts = Math.min(maxCrafts, have / entry.getValue());
        }

        // Limit by inventory space
        Slot resultSlot = handler.getSlot(resultSlotId);
        if (resultSlot.hasStack()) {
            ItemStack resultStack = resultSlot.getStack();
            int resultCount = resultStack.getCount();
            int maxStack = resultStack.getMaxCount();
            int space = 0;
            for (Slot slot : playerSlots) {
                if (!slot.hasStack()) space += maxStack;
                else if (ItemStack.areItemsEqual(slot.getStack(), resultStack))
                    space += maxStack - slot.getStack().getCount();
            }
            maxCrafts = Math.min(maxCrafts, Math.max(1, space / resultCount));
        }

        if (maxCrafts <= 0) return 0;

        // Take first result
        shiftClick(client, syncId, resultSlotId);
        int crafted = 1;

        // Repeat: refill grid, take result
        for (int craft = 1; craft < maxCrafts; craft++) {
            boolean canFill = true;
            for (Map.Entry<Integer, Integer> entry : recipePattern.entrySet()) {
                int gridIdx = entry.getKey();
                int slotId = gridSlotIds.get(gridIdx);
                Slot gridSlot = handler.getSlot(slotId);

                // Skip if already has correct item
                if (gridSlot.hasStack()) {
                    int currentId = Registries.ITEM.getRawId(gridSlot.getStack().getItem());
                    if (currentId == entry.getValue()) continue;
                }

                // Find material in inventory
                boolean found = false;
                for (Slot pSlot : playerSlots) {
                    if (pSlot.hasStack()) {
                        int pId = Registries.ITEM.getRawId(pSlot.getStack().getItem());
                        if (pId == entry.getValue()) {
                            click(client, syncId, pSlot.id);
                            rightClick(client, syncId, slotId);
                            click(client, syncId, pSlot.id);
                            found = true;
                            break;
                        }
                    }
                }
                if (!found) { canFill = false; break; }
            }

            if (!canFill) break;
            shiftClick(client, syncId, resultSlotId);
            crafted++;
        }

        return crafted;
    }

    // ══════════════════════════════════════════════════
    // SWIPE RIGHT → Dump to Chest
    // ══════════════════════════════════════════════════
    private static void onSwipeRight(MinecraftClient client) {
        if (client.player == null || client.interactionManager == null) return;
        Screen screen = client.currentScreen;
        if (!(screen instanceof GenericContainerScreen)) {
            DynamicIslandMod.triggerSilentNotification("Open a chest first!", "general");
            return;
        }

        HandledScreen<?> hs = (HandledScreen<?>) screen;
        ScreenHandler handler = hs.getScreenHandler();
        int syncId = handler.syncId;

        int dumped = 0;
        for (Slot slot : handler.slots) {
            if (slot.inventory != client.player.getInventory()) continue;
            if (!slot.hasStack()) continue;
            if (isProtectedItem(slot.getStack())) continue;
            shiftClick(client, syncId, slot.id);
            dumped++;
        }

        DynamicIslandMod.triggerSilentNotification("Dumped " + dumped + " stacks to chest", "general");
    }

    // ══════════════════════════════════════════════════
    // ITEM CLASSIFICATION
    // ══════════════════════════════════════════════════

    private static boolean isProtectedItem(ItemStack stack) {
        Item item = stack.getItem();
        if (item instanceof ToolItem) return true;
        if (item instanceof SwordItem) return true;
        if (item instanceof BowItem) return true;
        if (item instanceof CrossbowItem) return true;
        if (item instanceof TridentItem) return true;
        if (item instanceof ShieldItem) return true;
        if (item instanceof FishingRodItem) return true;
        if (item instanceof FlintAndSteelItem) return true;
        if (item instanceof ShearsItem) return true;
        if (item instanceof ArmorItem) return true;
        if (item == Items.ELYTRA) return true;
        if (item == Items.TOTEM_OF_UNDYING) return true;
        return false;
    }

    private static int getCategoryOrder(ItemStack stack) {
        Item item = stack.getItem();
        if (item instanceof SwordItem) return 0;
        if (item instanceof ToolItem) return 1;
        if (item instanceof BowItem || item instanceof CrossbowItem || item instanceof TridentItem) return 2;
        if (item instanceof ArmorItem) return 3;
        if (item == Items.ELYTRA) return 4;
        if (item == Items.TOTEM_OF_UNDYING || item instanceof ShieldItem) return 5;
        if (item.getComponents().contains(net.minecraft.component.DataComponentTypes.FOOD)) return 6;
        if (item instanceof BlockItem) return 7;
        return 8;
    }
}
