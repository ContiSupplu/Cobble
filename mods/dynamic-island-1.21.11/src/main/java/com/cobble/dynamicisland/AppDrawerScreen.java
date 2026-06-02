package com.cobble.dynamicisland;

import net.minecraft.client.gui.Click;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.input.KeyInput;
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
    public boolean mouseClicked(Click click, boolean bl) {
        if (click.button() == 0) {
            clickX = (int) click.x();
            clickY = (int) click.y();
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
    public boolean keyPressed(KeyInput keyInput) {
        int keyCode = keyInput.key();
        if (keyCode == org.lwjgl.glfw.GLFW.GLFW_KEY_ESCAPE || keyCode == org.lwjgl.glfw.GLFW.GLFW_KEY_X) {
            DynamicIslandHud.isAppDrawerOpen = false;
            DynamicIslandMod.isAppDrawerOpen = false;
            this.close();
            return true;
        }
        return super.keyPressed(keyInput);
    }
}
