package com.cobble.dynamicisland;

import net.minecraft.client.texture.AbstractTexture;
import com.mojang.blaze3d.textures.GpuTexture;
import com.mojang.blaze3d.textures.GpuTextureView;

/**
 * A thin wrapper that lets us register MCEF Modern's GpuTexture / GpuTextureView
 * with Minecraft's TextureManager under a custom Identifier.
 *
 * DrawContext.drawTexture() looks up the Identifier -> AbstractTexture -> getGlTexture() / getGlTextureView().
 * By pointing those at MCEF Modern's browser texture, the standard draw path works.
 */
public class BrowserTexture extends AbstractTexture {

    /**
     * Update the backing GPU texture from the MCEF Modern browser.
     * Called every frame before drawing.
     */
    public void updateFrom(GpuTexture texture, GpuTextureView textureView) {
        // AbstractTexture has protected fields: glTexture, glTextureView
        this.glTexture = texture;
        this.glTextureView = textureView;
    }

    @Override
    public void close() {
        // Don't close — MCEF Modern owns the texture lifecycle
        this.glTexture = null;
        this.glTextureView = null;
    }
}
