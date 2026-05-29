package com.cobble.dynamicisland;

import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;
import org.lwjgl.glfw.GLFW;

/**
 * Transparent screen for Settings — captures mouse clicks, scroll, and keyboard.
 * All rendering done by DynamicIslandHud.
 */
public class SettingsScreen extends Screen {

    public SettingsScreen() {
        super(Text.literal("Settings"));
    }

    @Override
    public boolean keyPressed(int keyCode, int scanCode, int modifiers) {
        if (keyCode == GLFW.GLFW_KEY_ESCAPE || keyCode == GLFW.GLFW_KEY_G) {
            DynamicIslandMod.isSettingsOpen = false;
            this.close();
            return true;
        }
        return super.keyPressed(keyCode, scanCode, modifiers);
    }

    @Override
    public boolean mouseScrolled(double mouseX, double mouseY, double horizontalAmount, double verticalAmount) {
        DynamicIslandMod.settingsScroll += (int)(verticalAmount * 20);
        return true;
    }

    @Override
    public boolean mouseClicked(double mouseX, double mouseY, int button) {
        if (button == 0) {
            // Pass click coords to HUD for toggle/button handling
            DynamicIslandMod.settingsClickX = (int) mouseX;
            DynamicIslandMod.settingsClickY = (int) mouseY;
            DynamicIslandMod.settingsClickPending = true;
        }
        return super.mouseClicked(mouseX, mouseY, button);
    }

    @Override
    public void renderBackground(DrawContext ctx, int mouseX, int mouseY, float delta) {}

    @Override
    public void render(DrawContext ctx, int mouseX, int mouseY, float delta) {}

    @Override
    public boolean shouldPause() { return false; }
}
