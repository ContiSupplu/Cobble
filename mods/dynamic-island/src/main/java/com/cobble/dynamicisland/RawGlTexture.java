package com.cobble.dynamicisland;

import net.minecraft.client.texture.AbstractTexture;
import net.minecraft.resource.ResourceManager;
import com.mojang.blaze3d.systems.RenderSystem;

/**
 * Wraps a raw OpenGL texture ID (from WATERMeDIA's VideoPlayer.texture())
 * so it can be used with Minecraft's DrawContext.drawTexture() API.
 *
 * DrawContext.drawTexture internally calls getGlId() to bind the texture,
 * so by overriding that we can render WATERMeDIA's video frames.
 */
public class RawGlTexture extends AbstractTexture {

    private int glId = 0;
    private int width = 1;
    private int height = 1;

    /**
     * Update the GL texture ID each frame (WATERMeDIA may recreate it).
     */
    public void setGlId(int id) {
        this.glId = id;
    }

    public void setDimensions(int w, int h) {
        if (w > 0) this.width = w;
        if (h > 0) this.height = h;
    }

    public int getFrameWidth() { return width; }
    public int getFrameHeight() { return height; }

    @Override
    public int getGlId() {
        return glId;
    }

    @Override
    public void load(ResourceManager manager) {
        // No-op: texture data comes from WATERMeDIA/VLC
    }

    @Override
    public void close() {
        // Don't delete the GL texture — WATERMeDIA owns it
        this.glId = 0;
    }
}
