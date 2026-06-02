package com.loom.mceftwitch;

import net.fabricmc.api.ClientModInitializer;

/**
 * MCEF Twitch Addon — Fixes Twitch video playback in MCEF Modern browsers.
 *
 * Root cause: MCEF Modern sets user_agent_product to "MCEF-Modern/0" which
 * Twitch rejects (Error #4000). Additionally, CEF in OSR mode may need
 * explicit codec capability overrides for H.264/AAC.
 *
 * This addon provides TwitchFixer which can be called by any mod that creates
 * MCEF browser instances. It injects JavaScript to:
 *   1. Override navigator.userAgent to a real Chrome UA string
 *   2. Override MediaSource.isTypeSupported to report H.264 support
 *   3. Override HTMLMediaElement.canPlayType for mp4/avc1 types
 *   4. Dismiss mature content / autoplay overlays on Twitch
 */
public class MCEFTwitchAddon implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        System.out.println("[MCEF-Twitch] Addon loaded — Twitch video fix active");
        System.out.println("[MCEF-Twitch] TwitchFixer.injectTwitchFix() available for browser mods");
    }
}
