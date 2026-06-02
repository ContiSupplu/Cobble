package com.cobble.dynamicisland;

import net.minecraft.client.texture.AbstractTexture;
import net.minecraft.resource.ResourceManager;

/**
 * Wraps a raw OpenGL texture ID (from WATERMeDIA's VideoPlayer.texture())
 * so it can be used with Minecraft's DrawContext.drawTexture() API.
 *
 * DrawContext.drawTexture internally calls getGlId() to bind the texture,
 * so by setting the glId field we can render WATERMeDIA's video frames.
 */
public class RawGlTexture extends AbstractTexture {

    private int rawGlId = 0;
    private int width = 1;
    private int height = 1;

    /**
     * Update the GL texture ID each frame (WATERMeDIA may recreate it).
     */
    public void setGlId(int id) {
        this.rawGlId = id;
    }

    /**
     * Get the current raw GL texture ID.
     */
    public int getGlId() {
        // If we have a raw ID set, return it; otherwise return 0
        if (rawGlId > 0) return rawGlId;
        return 0;
    }

    public void setDimensions(int w, int h) {
        if (w > 0) this.width = w;
        if (h > 0) this.height = h;
    }

    public int getFrameWidth() { return width; }
    public int getFrameHeight() { return height; }

    @Override
    public void close() {
        // Don't delete the GL texture — WATERMeDIA owns it
        this.rawGlId = 0;
    }
}
