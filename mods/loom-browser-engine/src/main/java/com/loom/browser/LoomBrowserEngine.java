package com.loom.browser;

import net.fabricmc.api.ClientModInitializer;

import java.io.File;
import java.nio.file.Path;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import org.cef.CefApp;
import org.cef.CefClient;
import org.cef.CefSettings;

import me.friwi.jcefmaven.CefAppBuilder;

/**
 * Loom Browser Engine — a Fabric client mod that initializes JCEF directly,
 * bypassing MCEF Modern. This gives us full control over CEF settings,
 * command-line switches, and proprietary codec support.
 * <p>
 * The mod provides a public API that InGameBrowser.java detects via reflection:
 * <ul>
 *   <li>{@link #isInitialized()} — check if CEF is ready</li>
 *   <li>{@link #initialize()} — start async CEF init, returns CompletableFuture</li>
 *   <li>{@link #createBrowser(String, boolean)} — create a LoomBrowser instance</li>
 * </ul>
 */
public class LoomBrowserEngine implements ClientModInitializer {

    private static CefApp cefApp;
    private static CefClient cefClient;
    private static final AtomicBoolean initialized = new AtomicBoolean(false);
    private static final AtomicBoolean initializing = new AtomicBoolean(false);
    private static volatile CompletableFuture<Void> initFuture;

    private static final String USER_AGENT =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

    @Override
    public void onInitializeClient() {
        System.out.println("[Loom Browser] Engine loaded — CEF will initialize lazily on first browser request");
    }

    /**
     * Initialize CEF asynchronously. Returns a future that completes when CEF is ready.
     * Safe to call multiple times — subsequent calls return the same future.
     */
    public static CompletableFuture<Void> initialize() {
        if (initialized.get()) return CompletableFuture.completedFuture(null);
        if (initializing.compareAndSet(false, true)) {
            initFuture = CompletableFuture.runAsync(LoomBrowserEngine::initCef);
        }
        return initFuture;
    }

    private static void initCef() {
        try {
            // Check for existing MCEF Modern natives first
            Path mcefNatives = findMcefNatives();

            // Install directory for JCEF (jcefmaven downloads here if needed)
            Path installDir = Path.of(System.getProperty("user.home"), ".loom-browser");
            installDir.toFile().mkdirs();

            // If MCEF Modern natives exist, symlink/copy them to avoid re-downloading
            if (mcefNatives != null) {
                System.out.println("[Loom Browser] Found MCEF Modern natives at: " + mcefNatives);
                installDir = mcefNatives.getParent(); // Use the mcef-modern config dir
            }

            CefAppBuilder builder = new CefAppBuilder();
            builder.setInstallDir(installDir.toFile());

            // Progress handler for download status
            builder.setProgressHandler(new me.friwi.jcefmaven.IProgressHandler() {
                @Override
                public void handleProgress(me.friwi.jcefmaven.EnumProgress state, float percent) {
                    System.out.println("[Loom Browser] CEF install: " + state + " " + (int)(percent * 100) + "%");
                }
            });

            // CEF settings
            CefSettings settings = builder.getCefSettings();
            settings.windowless_rendering_enabled = true;
            settings.user_agent = USER_AGENT;
            settings.cache_path = installDir.resolve("cache").toString();
            settings.root_cache_path = installDir.resolve("cache").toString();
            settings.log_severity = CefSettings.LogSeverity.LOGSEVERITY_WARNING;

            // Command-line switches for media support
            builder.addJcefArgs(
                "--autoplay-policy=no-user-gesture-required",
                "--enable-media-stream",
                "--disable-gpu-sandbox",
                "--off-screen-rendering-enabled",
                "--off-screen-frame-rate=60",
                "--disable-gpu-compositing"
            );

            // Build CefApp — this downloads natives if needed, then creates the app
            cefApp = builder.build();
            cefClient = cefApp.createClient();

            initialized.set(true);
            System.out.println("[Loom Browser] CEF initialized successfully!");

        } catch (me.friwi.jcefmaven.CefInitializationException e) {
            System.err.println("[Loom Browser] CEF initialization failed: " + e.getMessage());
            e.printStackTrace();
        } catch (me.friwi.jcefmaven.UnsupportedPlatformException e) {
            System.err.println("[Loom Browser] Unsupported platform: " + e.getMessage());
            e.printStackTrace();
        } catch (InterruptedException e) {
            System.err.println("[Loom Browser] CEF init interrupted: " + e.getMessage());
            Thread.currentThread().interrupt();
        } catch (Exception e) {
            System.err.println("[Loom Browser] Unexpected error during CEF init: " + e.getMessage());
            e.printStackTrace();
        }
    }

    /**
     * Look for existing MCEF Modern native libraries to avoid re-downloading CEF.
     */
    private static Path findMcefNatives() {
        // Check standard MCEF Modern locations
        String[] candidates = {
            System.getProperty("user.dir") + "/config/mcef-modern/jcef",
            System.getenv("APPDATA") + "/loom-launcher/instances/my-main-man-copy-6lss/config/mcef-modern/jcef",
        };
        for (String path : candidates) {
            File dir = new File(path);
            if (dir.exists() && new File(dir, "libcef.dll").exists()) {
                return dir.toPath();
            }
        }
        return null;
    }

    public static boolean isInitialized() {
        return initialized.get();
    }

    public static CefApp getCefApp() {
        return cefApp;
    }

    public static CefClient getCefClient() {
        return cefClient;
    }

    /**
     * Create a new browser instance. CEF must be initialized first.
     *
     * @param url         Initial URL to load
     * @param transparent Whether the browser background should be transparent
     * @return A LoomBrowser wrapping a JCEF OSR browser
     * @throws IllegalStateException if CEF is not initialized
     */
    public static LoomBrowser createBrowser(String url, boolean transparent) {
        if (!initialized.get()) {
            throw new IllegalStateException("[Loom Browser] CEF not initialized! Call initialize() first.");
        }
        return new LoomBrowser(cefClient, url, transparent);
    }

    /**
     * Shut down CEF. Called when the game exits.
     */
    public static void shutdown() {
        if (cefApp != null) {
            System.out.println("[Loom Browser] Shutting down CEF...");
            cefApp.dispose();
            cefApp = null;
            cefClient = null;
            initialized.set(false);
        }
    }
}
