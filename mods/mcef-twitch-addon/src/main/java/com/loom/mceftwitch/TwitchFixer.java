package com.loom.mceftwitch;

import java.lang.reflect.Method;

/**
 * Core Twitch fix logic for MCEF Modern browsers.
 *
 * Provides static methods that any mod can call (directly or via reflection)
 * to fix Twitch video playback in CEF-based browsers.
 *
 * Usage from another mod:
 *   TwitchFixer.injectTwitchFix(cefBrowser);   // call on page load start
 *   TwitchFixer.injectPlayerFix(cefBrowser);    // call 3-5 seconds after page load
 */
public class TwitchFixer {

    // Chrome 143 user agent string — matches CEF version used by MCEF Modern
    private static final String CHROME_UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

    /**
     * Inject Twitch fix JavaScript into the given CefBrowser instance.
     * This must be called EARLY — ideally on page load start or right after loadURL.
     *
     * Fixes applied:
     *   1. Override navigator.userAgent/vendor/platform/appVersion to mimic Chrome
     *   2. Override MediaSource.isTypeSupported to report H.264/AAC support
     *   3. Override HTMLMediaElement.canPlayType for H.264/mp4 types
     *
     * @param cefBrowser The CefBrowser instance (obtained via reflection from MCEFBrowser)
     */
    public static void injectTwitchFix(Object cefBrowser) {
        if (cefBrowser == null) return;
        try {
            // Find executeJavaScript method on the CefBrowser
            Method execJS = null;
            for (Method m : cefBrowser.getClass().getMethods()) {
                if (m.getName().equals("executeJavaScript") && m.getParameterCount() == 3) {
                    execJS = m;
                    break;
                }
            }
            if (execJS == null) {
                System.out.println("[MCEF-Twitch] Could not find executeJavaScript method");
                return;
            }

            // 1. Override navigator properties to mimic Chrome
            String uaOverride =
                "(function(){" +
                "  try {" +
                "    Object.defineProperty(navigator, 'userAgent', {" +
                "      get: function() { return '" + CHROME_UA + "'; }" +
                "    });" +
                "    Object.defineProperty(navigator, 'vendor', {" +
                "      get: function() { return 'Google Inc.'; }" +
                "    });" +
                "    Object.defineProperty(navigator, 'platform', {" +
                "      get: function() { return 'Win32'; }" +
                "    });" +
                "    Object.defineProperty(navigator, 'appVersion', {" +
                "      get: function() { return '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36'; }" +
                "    });" +
                "    console.log('[MCEF-Twitch] UA override applied');" +
                "  } catch(e) { console.log('[MCEF-Twitch] UA override error:', e); }" +
                "})();";
            execJS.invoke(cefBrowser, uaOverride, "about:blank", 0);

            // 2. Ensure MediaSource API is detected with H.264 support
            String mseFix =
                "(function(){" +
                "  try {" +
                "    if (!window.MediaSource) {" +
                "      console.log('[MCEF-Twitch] MediaSource not available');" +
                "    } else {" +
                "      console.log('[MCEF-Twitch] MediaSource available — patching isTypeSupported');" +
                "      var origIsTypeSupported = MediaSource.isTypeSupported.bind(MediaSource);" +
                "      MediaSource.isTypeSupported = function(mimeType) {" +
                "        if (mimeType && mimeType.indexOf('avc1') !== -1) return true;" +
                "        if (mimeType && mimeType.indexOf('mp4a') !== -1) return true;" +
                "        if (mimeType && mimeType.indexOf('avc') !== -1) return true;" +
                "        return origIsTypeSupported(mimeType);" +
                "      };" +
                "    }" +
                "  } catch(e) { console.log('[MCEF-Twitch] MSE fix error:', e); }" +
                "})();";
            execJS.invoke(cefBrowser, mseFix, "about:blank", 0);

            // 3. Override HTMLMediaElement.canPlayType to report H.264 support
            String canPlayFix =
                "(function(){" +
                "  try {" +
                "    var origCanPlay = HTMLMediaElement.prototype.canPlayType;" +
                "    HTMLMediaElement.prototype.canPlayType = function(type) {" +
                "      if (type && (type.indexOf('avc1') !== -1 || type.indexOf('mp4') !== -1 || type.indexOf('avc') !== -1)) {" +
                "        return 'probably';" +
                "      }" +
                "      return origCanPlay.call(this, type);" +
                "    };" +
                "    console.log('[MCEF-Twitch] canPlayType override applied');" +
                "  } catch(e) { console.log('[MCEF-Twitch] canPlayType error:', e); }" +
                "})();";
            execJS.invoke(cefBrowser, canPlayFix, "about:blank", 0);

            System.out.println("[MCEF-Twitch] Injected Twitch fixes (UA + MSE + canPlayType)");

        } catch (Exception e) {
            System.out.println("[MCEF-Twitch] Error injecting fix: " + e.getMessage());
            e.printStackTrace();
        }
    }

    /**
     * Check if a URL is a Twitch page that needs fixing.
     */
    public static boolean isTwitchUrl(String url) {
        return url != null && (url.contains("twitch.tv") || url.contains("player.twitch.tv"));
    }

    /**
     * Inject a delayed player fix that clicks through overlays and tries to start playback.
     * Call this after the page has loaded (e.g., after 3-5 seconds).
     *
     * @param cefBrowser The CefBrowser instance
     */
    public static void injectPlayerFix(Object cefBrowser) {
        if (cefBrowser == null) return;
        try {
            Method execJS = null;
            for (Method m : cefBrowser.getClass().getMethods()) {
                if (m.getName().equals("executeJavaScript") && m.getParameterCount() == 3) {
                    execJS = m;
                    break;
                }
            }
            if (execJS == null) return;

            String playerFix =
                "(function(){" +
                "  try {" +
                // Dismiss mature content / Start Watching overlays
                "    var btns = document.querySelectorAll('[data-a-target=\"content-classification-gate-overlay-start-watching-button\"]');" +
                "    btns.forEach(function(b) { b.click(); });" +
                "    var accept = document.querySelectorAll('button[data-a-target=\"player-overlay-mature-accept\"]');" +
                "    accept.forEach(function(b) { b.click(); });" +
                // Try to unmute
                "    var muteBtn = document.querySelector('[data-a-target=\"player-mute-unmute-button\"]');" +
                "    if (muteBtn) {" +
                "      var vol = muteBtn.getAttribute('aria-label');" +
                "      if (vol && vol.toLowerCase().includes('unmute')) muteBtn.click();" +
                "    }" +
                // Click play if paused
                "    var playBtn = document.querySelector('[data-a-target=\"player-play-pause-button\"]');" +
                "    if (playBtn) {" +
                "      var label = playBtn.getAttribute('aria-label');" +
                "      if (label && label.toLowerCase().includes('play')) playBtn.click();" +
                "    }" +
                "    console.log('[MCEF-Twitch] Player fix applied');" +
                "  } catch(e) { console.log('[MCEF-Twitch] Player fix error:', e); }" +
                "})();";
            execJS.invoke(cefBrowser, playerFix, "", 0);

            System.out.println("[MCEF-Twitch] Injected player fix (overlays + unmute + play)");

        } catch (Exception e) {
            System.out.println("[MCEF-Twitch] Player fix error: " + e.getMessage());
        }
    }
}
