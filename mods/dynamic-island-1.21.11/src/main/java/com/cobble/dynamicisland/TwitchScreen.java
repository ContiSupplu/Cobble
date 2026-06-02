package com.cobble.dynamicisland;

import net.minecraft.client.gui.Click;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.TextFieldWidget;
import net.minecraft.client.input.CharInput;
import net.minecraft.client.input.KeyInput;
import net.minecraft.text.Text;
import org.lwjgl.glfw.GLFW;

/**
 * Transparent screen for the media viewer panel.
 * Mouse-first design — all controls are clickable via cursor.
 *
 * Keyboard only used for:
 *   - Typing in search box
 *   - Enter to submit search
 *   - ESC to close (without stopping playback)
 *
 * Mouse events forwarded to DynamicIslandHud for:
 *   - Clicking search results, tabs, pagination
 *   - Play/pause, seek, volume, back button
 *   - Progress bar scrubbing
 */
public class TwitchScreen extends Screen {

    private TextFieldWidget inputField;

    // Click state for HUD consumption
    public static int clickX = -1, clickY = -1;
    public static boolean clickPending = false;
    public static double scrollDelta = 0;

    // Drag state for progress bar scrubbing
    public static boolean isDragging = false;
    public static int dragX = -1, dragY = -1;

    public TwitchScreen() {
        super(Text.literal("Media Viewer"));
    }

    @Override
    protected void init() {
        super.init();
        // Invisible input field — captures keystrokes for search
        int fieldW = 250;
        int fieldX = this.width / 2 - fieldW / 2;
        int fieldY = this.height; // offscreen — HUD renders the visual

        this.inputField = new TextFieldWidget(
                this.textRenderer, fieldX, fieldY, fieldW, 12,
                Text.literal("")
        );
        this.inputField.setMaxLength(500);
        this.inputField.setDrawsBackground(false);
        this.inputField.setEditableColor(0xEEEEEE);
        this.addDrawableChild(this.inputField);
        this.setInitialFocus(this.inputField);

        // Restore in-progress text
        if ("SEARCH".equals(MediaViewer.activeTab)) {
            this.inputField.setText(MediaViewer.searchQuery);
        } else if (MediaViewer.mediaType == MediaViewer.MediaType.TWITCH) {
            this.inputField.setText(TwitchChat.inputText);
        }
    }

    @Override
    public boolean keyPressed(KeyInput keyInput) {
        int keyCode = keyInput.key();
        boolean isSearchTab = "SEARCH".equals(MediaViewer.activeTab);

        // ESC — close panel WITHOUT stopping playback
        if (keyCode == GLFW.GLFW_KEY_ESCAPE) {
            DynamicIslandMod.isMediaOpen = false;
            // Don't call MediaViewer.closeStream() — video keeps playing in background
            this.close();
            return true;
        }

        // T key does NOT close — only ESC closes. This lets users type 't' in search.

        // Search mode — Enter to search or select
        if (isSearchTab) {
            if (keyCode == GLFW.GLFW_KEY_ENTER || keyCode == GLFW.GLFW_KEY_KP_ENTER) {
                String query = this.inputField.getText().trim();
                if (!query.isEmpty()) {
                    MediaViewer.sendSearch(query, MediaViewer.searchSource);
                }
                return true;
            }
            // Let text field handle typing
            boolean result = super.keyPressed(keyInput);
            MediaViewer.searchQuery = this.inputField.getText();
            return result;
        }

        // Twitch chat — Enter to send
        if (MediaViewer.mediaType == MediaViewer.MediaType.TWITCH && !isSearchTab) {
            if (keyCode == GLFW.GLFW_KEY_ENTER || keyCode == GLFW.GLFW_KEY_KP_ENTER) {
                String msg = this.inputField.getText().trim();
                if (!msg.isEmpty()) {
                    TwitchChat.sendMessage(msg);
                    this.inputField.setText("");
                    TwitchChat.inputText = "";
                }
                return true;
            }
            return super.keyPressed(keyInput);
        }

        return super.keyPressed(keyInput);
    }

    @Override
    public boolean charTyped(CharInput charInput) {
        boolean isSearchTab = "SEARCH".equals(MediaViewer.activeTab);
        if (isSearchTab || MediaViewer.mediaType == MediaViewer.MediaType.TWITCH) {
            boolean result = super.charTyped(charInput);
            if (isSearchTab) {
                MediaViewer.searchQuery = this.inputField.getText();
            } else {
                TwitchChat.inputText = this.inputField.getText();
            }
            return result;
        }
        return super.charTyped(charInput);
    }

    @Override
    public boolean keyReleased(KeyInput keyInput) {
        boolean isSearchTab = "SEARCH".equals(MediaViewer.activeTab);
        if (isSearchTab || MediaViewer.mediaType == MediaViewer.MediaType.TWITCH) {
            boolean result = super.keyReleased(keyInput);
            if (isSearchTab) {
                MediaViewer.searchQuery = this.inputField.getText();
            } else {
                TwitchChat.inputText = this.inputField.getText();
            }
            return result;
        }
        return super.keyReleased(keyInput);
    }

    // ── Mouse Events — forwarded to HUD for click detection ──

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
    public boolean mouseDragged(Click click, double deltaX, double deltaY) {
        if (click.button() == 0) {
            isDragging = true;
            dragX = (int) click.x();
            dragY = (int) click.y();
        }
        return true;
    }

    @Override
    public boolean mouseReleased(Click click) {
        isDragging = false;
        return true;
    }

    @Override
    public boolean mouseScrolled(double mouseX, double mouseY, double horizontalAmount, double verticalAmount) {
        scrollDelta += verticalAmount;
        return true;
    }

    @Override
    public void renderBackground(DrawContext ctx, int mouseX, int mouseY, float delta) {
        // Fully transparent — game stays visible
    }

    @Override
    public void render(DrawContext ctx, int mouseX, int mouseY, float delta) {
        // Forward mouse position to HUD for hover detection
        DynamicIslandHud.mouseX = mouseX;
        DynamicIslandHud.mouseY = mouseY;
    }

    @Override
    public boolean shouldPause() { return false; }
}
