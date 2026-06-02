package com.cobble.dynamicisland;

import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import net.minecraft.util.Identifier;
import org.lwjgl.glfw.GLFW;

/**
 * Registers keybinds for the Loom recording system.
 * <p>
 * F9  — Toggle continuous recording (start / stop)
 * F10 — Save replay buffer (last N seconds)
 */
public class CaptureKeybinds {

    private static final KeyBinding.Category CATEGORY =
            KeyBinding.Category.create(Identifier.of("cobble", "loom_recording"));

    private static KeyBinding toggleRecordingKey;
    private static KeyBinding saveReplayBufferKey;

    /**
     * Call once during mod initialisation to register keybinds and tick handler.
     */
    public static void register() {
        // F9 — Toggle recording
        toggleRecordingKey = KeyBindingHelper.registerKeyBinding(new KeyBinding(
                "Toggle Recording",
                InputUtil.Type.KEYSYM,
                GLFW.GLFW_KEY_F9,
                CATEGORY
        ));

        // F10 — Save replay buffer
        saveReplayBufferKey = KeyBindingHelper.registerKeyBinding(new KeyBinding(
                "Save Replay Buffer",
                InputUtil.Type.KEYSYM,
                GLFW.GLFW_KEY_F10,
                CATEGORY
        ));

        // Process key presses on every client tick
        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            while (toggleRecordingKey.wasPressed()) {
                CaptureManager.toggleRecording();
            }
            while (saveReplayBufferKey.wasPressed()) {
                CaptureManager.saveReplayBuffer();
            }
        });

        System.out.println("[Loom Capture] Keybinds registered (F9 = Record, F10 = Replay)");
    }
}
