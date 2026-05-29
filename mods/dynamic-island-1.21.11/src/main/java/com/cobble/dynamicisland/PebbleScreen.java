package com.cobble.dynamicisland;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.TextFieldWidget;
import net.minecraft.client.input.CharInput;
import net.minecraft.client.input.KeyInput;
import net.minecraft.text.Text;
import org.lwjgl.glfw.GLFW;

/**
 * Lightweight transparent screen — only captures keyboard input for Pebble.
 * All visual rendering happens in DynamicIslandHud.
 */
public class PebbleScreen extends Screen {

    private TextFieldWidget inputField;

    public PebbleScreen() {
        super(Text.literal("Pebble"));
    }

    @Override
    protected void init() {
        super.init();
        // Invisible input field — we just need it for keystroke capture
        int fieldW = 250;
        int fieldX = this.width / 2 - fieldW / 2;
        int fieldY = this.height; // offscreen — HUD renders the visual

        this.inputField = new TextFieldWidget(
                this.textRenderer, fieldX, fieldY, fieldW, 12,
                Text.literal("")
        );
        this.inputField.setMaxLength(256);
        this.inputField.setDrawsBackground(false);
        this.inputField.setEditableColor(0xEEEEEE);
        this.addDrawableChild(this.inputField);
        this.setInitialFocus(this.inputField);

        // Restore any in-progress text
        this.inputField.setText(DynamicIslandMod.pebbleInputText);
    }

    @Override
    public boolean keyPressed(KeyInput keyInput) {
        int keyCode = keyInput.key();
        if (keyCode == GLFW.GLFW_KEY_ENTER || keyCode == GLFW.GLFW_KEY_KP_ENTER) {
            String q = this.inputField.getText().trim();
            if (!q.isEmpty() && !DynamicIslandMod.pebbleWaiting) {
                DynamicIslandMod.pebbleWaiting = true;
                DynamicIslandMod.pebbleMessages.add(
                    new DynamicIslandMod.PebbleChatMsg(q, true)
                );
                this.inputField.setText("");
                DynamicIslandMod.pebbleInputText = "";
                DynamicIslandMod.pebbleScroll = 0;

                // Send to launcher
                String json = "{\"type\":\"pebble_question\",\"text\":\"" +
                        q.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ") + "\"}";
                if (LauncherWebSocket.getInstance() != null && LauncherWebSocket.getInstance().isOpen()) {
                    LauncherWebSocket.getInstance().send(json);
                } else {
                    DynamicIslandMod.addPebbleAnswer("Not connected to Cobble Launcher.");
                }
            }
            return true;
        }
        if (keyCode == GLFW.GLFW_KEY_ESCAPE) {
            DynamicIslandMod.isPebbleOpen = false;
            DynamicIslandMod.pebbleInputText = "";
            this.close();
            return true;
        }
        return super.keyPressed(keyInput);
    }

    @Override
    public boolean charTyped(CharInput charInput) {
        boolean result = super.charTyped(charInput);
        DynamicIslandMod.pebbleInputText = this.inputField.getText();
        return result;
    }

    @Override
    public boolean keyReleased(KeyInput keyInput) {
        boolean result = super.keyReleased(keyInput);
        DynamicIslandMod.pebbleInputText = this.inputField.getText();
        return result;
    }

    @Override
    public boolean mouseScrolled(double mouseX, double mouseY, double horizontalAmount, double verticalAmount) {
        DynamicIslandMod.pebbleScroll += (int)(verticalAmount * 20);
        return true;
    }

    @Override
    public void renderBackground(DrawContext ctx, int mouseX, int mouseY, float delta) {
        // Fully transparent — no dimming, game stays visible
    }

    @Override
    public void render(DrawContext ctx, int mouseX, int mouseY, float delta) {
        // Don't call super.render — we don't want the TextField to render
        // All visuals are handled by DynamicIslandHud
    }

    @Override
    public boolean shouldPause() { return false; }
}
