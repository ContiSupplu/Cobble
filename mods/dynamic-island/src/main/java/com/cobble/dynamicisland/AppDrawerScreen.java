package com.cobble.dynamicisland;

import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.text.Text;

public class AppDrawerScreen extends Screen {
    // Store click coordinates for the HUD to consume
    public static int clickX = -1, clickY = -1;
    public static boolean clickPending = false;
    public static double scrollDelta = 0;

    public AppDrawerScreen() {
        super(Text.literal("App Drawer"));
    }

    @Override
    public boolean shouldPause() { return false; }

    @Override
    public void renderBackground(DrawContext ctx, int mouseX, int mouseY, float delta) {}

    @Override
    public void render(DrawContext ctx, int mouseX, int mouseY, float delta) {
        // Store mouse position for HUD hover detection
        DynamicIslandHud.mouseX = mouseX;
        DynamicIslandHud.mouseY = mouseY;
    }

    @Override
    public boolean mouseClicked(double mouseX, double mouseY, int button) {
        if (button == 0) {
            clickX = (int) mouseX;
            clickY = (int) mouseY;
            clickPending = true;
        }
        return true;
    }

    @Override
    public boolean mouseScrolled(double mouseX, double mouseY, double hAmount, double vAmount) {
        scrollDelta += vAmount;
        return true;
    }

    @Override
    public boolean keyPressed(int keyCode, int scanCode, int modifiers) {
        if (keyCode == org.lwjgl.glfw.GLFW.GLFW_KEY_ESCAPE || keyCode == org.lwjgl.glfw.GLFW.GLFW_KEY_X) {
            DynamicIslandHud.isAppDrawerOpen = false;
            DynamicIslandMod.isAppDrawerOpen = false;
            this.close();
            return true;
        }
        return super.keyPressed(keyCode, scanCode, modifiers);
    }
}
