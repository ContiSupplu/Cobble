package com.cobble.dynamicisland;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.font.TextRenderer;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.TextFieldWidget;
import net.minecraft.text.Text;
import org.lwjgl.glfw.GLFW;

import java.util.ArrayList;
import java.util.List;

/**
 * Pebble AI — Premium in-game chat screen.
 */
public class PebbleScreen extends Screen {

    private TextFieldWidget inputField;
    private final List<ChatMessage> messages = new ArrayList<>();
    private boolean waiting = false;
    private int typingDots = 0;
    private long lastDotTime = 0;
    private int scrollOffset = 0;

    public PebbleScreen() {
        super(Text.literal("Pebble"));
    }

    @Override
    protected void init() {
        super.init();

        int fieldW = Math.min(320, this.width - 80);
        int fieldX = this.width / 2 - fieldW / 2 + 4;
        int fieldY = this.height - 36;

        this.inputField = new TextFieldWidget(
                this.textRenderer, fieldX, fieldY, fieldW - 8, 12,
                Text.literal("")
        );
        this.inputField.setMaxLength(256);
        this.inputField.setDrawsBackground(false);
        this.inputField.setEditableColor(0xEEEEEE);
        this.addDrawableChild(this.inputField);
        this.setInitialFocus(this.inputField);
    }

    @Override
    public boolean keyPressed(int keyCode, int scanCode, int modifiers) {
        if (keyCode == GLFW.GLFW_KEY_ENTER || keyCode == GLFW.GLFW_KEY_KP_ENTER) {
            String q = this.inputField.getText().trim();
            if (!q.isEmpty() && !waiting) {
                waiting = true;
                messages.add(new ChatMessage(q, true));
                this.inputField.setText("");

                String json = "{\"type\":\"pebble_question\",\"text\":\"" +
                        q.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ") + "\"}";
                if (LauncherWebSocket.getInstance() != null && LauncherWebSocket.getInstance().isOpen()) {
                    LauncherWebSocket.getInstance().send(json);
                } else {
                    setAnswer("Not connected to Cobble Launcher.");
                }
            }
            return true;
        }
        if (keyCode == GLFW.GLFW_KEY_ESCAPE) {
            this.close();
            return true;
        }
        return super.keyPressed(keyCode, scanCode, modifiers);
    }

    @Override
    public boolean mouseScrolled(double mouseX, double mouseY, double verticalAmount) {
        scrollOffset -= (int)(verticalAmount * 14);
        scrollOffset = Math.max(0, scrollOffset);
        return true;
    }

    public void setAnswer(String ans) {
        this.waiting = false;
        messages.add(new ChatMessage(ans, false));
        scrollOffset = 0;
    }

    @Override
    public void render(DrawContext ctx, int mouseX, int mouseY, float delta) {
        // ── Backdrop ───────────────────────────────
        ctx.fill(0, 0, this.width, this.height, 0xCC000000);

        TextRenderer font = this.textRenderer;
        int panelW = Math.min(340, this.width - 40);
        int panelX = this.width / 2 - panelW / 2;
        int panelTop = 35;
        int inputAreaH = 30;
        int panelBottom = this.height - inputAreaH - 18;
        int panelH = panelBottom - panelTop;

        // ── Panel ──────────────────────────────────
        drawRoundedRect(ctx, panelX, panelTop, panelW, panelH, 8, 0xEE111111);

        // ── Header ─────────────────────────────────
        int hY = panelTop + 8;

        // Purple star
        int starX = panelX + 12;
        ctx.fill(starX + 2, hY, starX + 5, hY + 7, 0xFF9B7DFF);
        ctx.fill(starX, hY + 2, starX + 7, hY + 5, 0xFF9B7DFF);

        ctx.drawTextWithShadow(font, "Pebble", panelX + 22, hY, 0xFFFFFF);
        ctx.drawTextWithShadow(font, "AI", panelX + 22 + font.getWidth("Pebble "), hY, 0x666666);

        // Separator
        int sepY = hY + 12;
        ctx.fill(panelX + 8, sepY, panelX + panelW - 8, sepY + 1, 0x15FFFFFF);

        // ── Messages ───────────────────────────────
        int msgTop = sepY + 6;
        int msgBottom = panelBottom - 4;
        int msgW = panelW - 24;

        // Total message height
        int totalH = 0;
        for (ChatMessage msg : messages) {
            totalH += getMsgHeight(font, msg.text, msgW - 14) + 10;
        }
        if (waiting) totalH += 16;

        int maxScroll = Math.max(0, totalH - (msgBottom - msgTop));
        scrollOffset = Math.min(scrollOffset, maxScroll);

        ctx.enableScissor(panelX, msgTop, panelX + panelW, msgBottom);

        int dy = msgTop;
        // Auto-scroll: if at or near bottom, snap
        if (scrollOffset <= 10) {
            dy = msgTop - maxScroll;
        } else {
            dy = msgTop - scrollOffset;
        }

        for (ChatMessage msg : messages) {
            int textH = getMsgHeight(font, msg.text, msgW - 14);
            int bH = textH + 8;

            if (msg.isUser) {
                int tw = getMaxLineW(font, msg.text, msgW - 14);
                int bW = Math.min(msgW, tw + 14);
                int bX = panelX + panelW - 12 - bW;

                drawRoundedRect(ctx, bX, dy, bW, bH, 5, 0x25FFFFFF);
                drawWrap(ctx, font, msg.text, bX + 7, dy + 4, msgW - 14, 0xDDDDDD);
            } else {
                int tw = getMaxLineW(font, msg.text, msgW - 14);
                int bW = Math.min(msgW, tw + 16);
                int bX = panelX + 12;

                drawRoundedRect(ctx, bX, dy, bW, bH, 5, 0x18FFFFFF);
                // Purple accent
                ctx.fill(bX + 1, dy + 3, bX + 3, dy + bH - 3, 0xFF9B7DFF);
                drawWrap(ctx, font, msg.text, bX + 9, dy + 4, msgW - 14, 0xBBBBBB);
            }
            dy += bH + 6;
        }

        // Typing dots
        if (waiting) {
            long now = System.currentTimeMillis();
            if (now - lastDotTime > 350) {
                typingDots = (typingDots + 1) % 4;
                lastDotTime = now;
            }
            int dotX = panelX + 20;
            for (int i = 0; i < 3; i++) {
                int a = (i < typingDots) ? 0xDD : 0x33;
                ctx.fill(dotX + i * 7, dy + 2, dotX + i * 7 + 3, dy + 5, (a << 24) | 0x9B7DFF);
            }
        }

        ctx.disableScissor();

        // Empty state
        if (messages.isEmpty() && !waiting) {
            String e = "Ask anything about Minecraft...";
            ctx.drawTextWithShadow(font, e, this.width / 2 - font.getWidth(e) / 2,
                    panelTop + panelH / 2 - 4, 0x555555);
        }

        // ── Custom input area ──────────────────────
        int inW = Math.min(320, this.width - 80);
        int inX = this.width / 2 - inW / 2;
        int inY = this.height - inputAreaH - 14;
        int inH = 20;

        // Draw rounded input background
        drawRoundedRect(ctx, inX, inY, inW, inH, 10, 0x44FFFFFF);

        // Placeholder text when empty
        if (inputField.getText().isEmpty()) {
            ctx.drawTextWithShadow(font, "Type a question...",
                    inX + 8, inY + 6, 0x666666);
        }

        // Render children (the invisible-background text field draws on top)
        super.render(ctx, mouseX, mouseY, delta);

        // Hint
        String hint = "Enter · send    Esc · close";
        ctx.drawTextWithShadow(font, hint, this.width / 2 - font.getWidth(hint) / 2,
                this.height - 10, 0x444444);
    }

    @Override
    public boolean shouldPause() {
        return false;
    }

    // ══════════════════════════════════════════════════
    // HELPERS
    // ══════════════════════════════════════════════════

    private int getMsgHeight(TextRenderer f, String t, int mw) {
        return wrap(f, t, mw).size() * 10;
    }

    private int getMaxLineW(TextRenderer f, String t, int mw) {
        int m = 0;
        for (String l : wrap(f, t, mw)) m = Math.max(m, f.getWidth(l));
        return m;
    }

    private void drawWrap(DrawContext ctx, TextRenderer f, String t, int x, int y, int mw, int c) {
        List<String> lines = wrap(f, t, mw);
        for (int i = 0; i < lines.size(); i++) {
            ctx.drawTextWithShadow(f, lines.get(i), x, y + i * 10, c);
        }
    }

    private List<String> wrap(TextRenderer f, String t, int mw) {
        List<String> lines = new ArrayList<>();
        if (t == null || t.isEmpty()) { lines.add(""); return lines; }
        String[] words = t.split(" ");
        StringBuilder cur = new StringBuilder();
        for (String w : words) {
            if (f.getWidth(w) > mw) {
                if (cur.length() > 0) { lines.add(cur.toString()); cur = new StringBuilder(); }
                StringBuilder part = new StringBuilder();
                for (char c : w.toCharArray()) {
                    if (f.getWidth(part.toString() + c) > mw) { lines.add(part.toString()); part = new StringBuilder(); }
                    part.append(c);
                }
                if (part.length() > 0) cur = part;
                continue;
            }
            String test = cur.length() > 0 ? cur + " " + w : w;
            if (f.getWidth(test) > mw) { lines.add(cur.toString()); cur = new StringBuilder(w); }
            else { if (cur.length() > 0) cur.append(" "); cur.append(w); }
        }
        if (cur.length() > 0) lines.add(cur.toString());
        if (lines.isEmpty()) lines.add("");
        return lines;
    }

    private void drawRoundedRect(DrawContext ctx, int x, int y, int w, int h, int r, int color) {
        if (r <= 0) { ctx.fill(x, y, x + w, y + h, color); return; }
        r = Math.min(r, Math.min(w / 2, h / 2));
        ctx.fill(x + r, y, x + w - r, y + h, color);
        ctx.fill(x, y + r, x + r, y + h - r, color);
        ctx.fill(x + w - r, y + r, x + w, y + h - r, color);
        for (int row = 0; row < r; row++) {
            int dy = r - row;
            int dx = (int) Math.round(r - Math.sqrt((double) r * r - (double) dy * dy));
            ctx.fill(x + dx, y + row, x + r, y + row + 1, color);
            ctx.fill(x + w - r, y + row, x + w - dx, y + row + 1, color);
            ctx.fill(x + dx, y + h - 1 - row, x + r, y + h - row, color);
            ctx.fill(x + w - r, y + h - 1 - row, x + w - dx, y + h - row, color);
        }
    }

    private static class ChatMessage {
        final String text;
        final boolean isUser;
        ChatMessage(String t, boolean u) { this.text = t; this.isUser = u; }
    }
}
