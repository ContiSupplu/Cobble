package com.cobble.dynamicisland.mixin;

import com.cobble.dynamicisland.p2p.P2PHandler;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.GameMenuScreen;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.text.Text;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Adds a "Play with Friends" button to the pause menu when in
 * singleplayer. Clicking it sends a P2P invite request to the
 * Loom launcher via WebSocket.
 */
@Mixin(GameMenuScreen.class)
public abstract class GameMenuScreenMixin extends Screen {

    protected GameMenuScreenMixin(Text title) {
        super(title);
    }

    @Inject(method = "init", at = @At("TAIL"))
    private void addPlayWithFriendsButton(CallbackInfo ci) {
        if (!MinecraftClient.getInstance().isInSingleplayer()) return;

        // Place below Save and Quit (standard layout bottom ~height/4 + 120)
        this.addDrawableChild(ButtonWidget.builder(
            Text.literal("Play with Friends"),
            button -> {
                P2PHandler.requestInvite();
                this.client.setScreen(null); // Close pause menu
            }
        ).dimensions(this.width / 2 - 102, this.height / 4 + 144, 204, 20).build());
    }
}
