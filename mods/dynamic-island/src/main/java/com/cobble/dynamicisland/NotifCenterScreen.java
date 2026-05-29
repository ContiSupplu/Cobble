package com.cobble.dynamicisland;

import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;
import org.lwjgl.glfw.GLFW;

/**
 * Transparent screen for the Notification Center — captures scroll, clicks, and keyboard.
 * Has 3 tabs: Notifications, Waypoints, Timers.
 * All rendering done by DynamicIslandHud.
 */
public class NotifCenterScreen extends Screen {

    public NotifCenterScreen() {
        super(Text.literal("Notifications"));
    }

    @Override
    public boolean keyPressed(int keyCode, int scanCode, int modifiers) {
        if (keyCode == GLFW.GLFW_KEY_ESCAPE || keyCode == GLFW.GLFW_KEY_N) {
            DynamicIslandMod.isNotifCenterOpen = false;
            this.close();
            return true;
        }
        // C to clear notifications (only on notifications tab)
        if (keyCode == GLFW.GLFW_KEY_C && DynamicIslandMod.notifCenterTab == 0) {
            DynamicIslandMod.notifHistory.clear();
            DynamicIslandMod.notifCenterScroll = 0;
            return true;
        }
        // Tab switching with 1, 2, 3
        if (keyCode == GLFW.GLFW_KEY_1) { DynamicIslandMod.notifCenterTab = 0; DynamicIslandMod.notifCenterScroll = 0; return true; }
        if (keyCode == GLFW.GLFW_KEY_2) { DynamicIslandMod.notifCenterTab = 1; DynamicIslandMod.notifCenterScroll = 0; return true; }
        if (keyCode == GLFW.GLFW_KEY_3) { DynamicIslandMod.notifCenterTab = 2; DynamicIslandMod.notifCenterScroll = 0; return true; }
        return super.keyPressed(keyCode, scanCode, modifiers);
    }

    @Override
    public boolean mouseScrolled(double mouseX, double mouseY, double horizontalAmount, double verticalAmount) {
        DynamicIslandMod.notifCenterScroll += (int)(verticalAmount * 20);
        return true;
    }

    @Override
    public boolean mouseClicked(double mouseX, double mouseY, int button) {
        // Forward clicks to HUD for waypoint/timer/tab handling
        DynamicIslandMod.notifClickX = (int) mouseX;
        DynamicIslandMod.notifClickY = (int) mouseY;
        DynamicIslandMod.notifClickButton = button;
        DynamicIslandMod.notifClickPending = true;
        return super.mouseClicked(mouseX, mouseY, button);
    }

    @Override
    public void renderBackground(DrawContext ctx, int mouseX, int mouseY, float delta) {}

    @Override
    public void render(DrawContext ctx, int mouseX, int mouseY, float delta) {}

    @Override
    public boolean shouldPause() { return false; }
}
