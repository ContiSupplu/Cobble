package com.cobble.dynamicisland;

import net.minecraft.client.MinecraftClient;
import net.minecraft.text.Text;
import org.lwjgl.opengl.GL11;
import org.lwjgl.opengl.GL15;
import org.lwjgl.opengl.GL21;

import java.nio.ByteBuffer;
import java.nio.file.*;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

/**
 * Core capture system for the Loom recording feature.
 * <p>
 * Uses two OpenGL PBOs (Pixel Buffer Objects) in a ping-pong pattern for
 * asynchronous frame readback — one PBO is being filled by the GPU while the
 * CPU reads the completed data from the other.  This avoids stalling the
 * render thread on {@code glReadPixels}.
 * <p>
 * Frames are forwarded to {@link VideoEncoder} instances that pipe raw RGBA
 * data into an FFmpeg process for hardware-accelerated encoding.
 */
public class CaptureManager {

    private static CaptureManager instance;

    // ── PBO state ─────────────────────────────────────
    private int[] pboIds = new int[2];
    private int currentPbo = 0;
    private boolean pbosInitialised = false;

    // ── Recording state ───────────────────────────────
    private boolean recording = false;
    private long recordingStartTime = 0;
    private boolean replayBufferActive = false;
    private VideoEncoder encoder;        // continuous recording
    private VideoEncoder replayEncoder;  // rolling replay buffer
    private long frameCount = 0;
    private int captureWidth;
    private int captureHeight;

    // ── Frame-rate control ────────────────────────────
    private long lastCaptureTimeNs = 0;
    private long framePeriodNs;          // min nanoseconds between captures

    // ── Segment temp dir for replay buffer ────────────
    private Path replayTempDir;

    // ══════════════════════════════════════════════════
    //  Public API (static delegates)
    // ══════════════════════════════════════════════════

    /**
     * Called once during mod initialisation.
     * Creates PBOs and starts the replay buffer encoder.
     */
    public static void init() {
        if (instance != null) return;
        instance = new CaptureManager();
        instance.initialise();
        System.out.println("[Loom Capture] CaptureManager initialised");
    }

    /**
     * Called every frame after Minecraft has finished rendering.
     * Should be invoked from a mixin or end-of-frame hook on the render thread.
     */
    public static void onFrameEnd() {
        if (instance == null) return;
        instance.captureFrame();
    }

    /** F9 handler — toggle continuous recording on/off. */
    public static void toggleRecording() {
        if (instance == null) return;
        if (instance.recording) {
            instance.stopRecording();
        } else {
            instance.startRecording();
        }
    }

    /** F10 handler — save the replay buffer to disk. */
    public static void saveReplayBuffer() {
        if (instance == null) return;
        instance.doSaveReplayBuffer();
    }

    public static boolean isRecording() {
        return instance != null && instance.recording;
    }

    public static long getRecordingStartTime() {
        return instance != null ? instance.recordingStartTime : 0;
    }

    public static boolean isReplayBufferActive() {
        return instance != null && instance.replayBufferActive;
    }

    /** Clean up PBOs and stop all encoders. */
    public static void shutdown() {
        if (instance == null) return;
        instance.doShutdown();
        instance = null;
    }

    // ══════════════════════════════════════════════════
    //  Internal implementation
    // ══════════════════════════════════════════════════

    private void initialise() {
        CaptureConfig cfg = CaptureConfig.getInstance();
        framePeriodNs = 1_000_000_000L / cfg.maxFps;

        // Ensure recordings directory exists
        try {
            Files.createDirectories(Path.of(cfg.recordingsDir));
        } catch (Exception e) {
            System.err.println("[Loom Capture] Could not create recordings dir: " + e.getMessage());
        }

        // Replay-buffer temp dir
        try {
            replayTempDir = Files.createTempDirectory("loom-replay-");
            replayTempDir.toFile().deleteOnExit();
        } catch (Exception e) {
            System.err.println("[Loom Capture] Could not create replay temp dir: " + e.getMessage());
            replayTempDir = Path.of(cfg.recordingsDir);
        }

        // PBOs will be created lazily on the render thread (first frame)
    }

    // ── PBO setup (must run on render thread) ─────────

    private void ensurePbos() {
        if (pbosInitialised) return;

        MinecraftClient mc = MinecraftClient.getInstance();
        captureWidth = resolveWidth(mc);
        captureHeight = resolveHeight(mc);

        int bufferSize = captureWidth * captureHeight * 4; // RGBA

        pboIds[0] = GL15.glGenBuffers();
        pboIds[1] = GL15.glGenBuffers();
        for (int id : pboIds) {
            GL15.glBindBuffer(GL21.GL_PIXEL_PACK_BUFFER, id);
            GL15.glBufferData(GL21.GL_PIXEL_PACK_BUFFER, bufferSize, GL15.GL_STREAM_READ);
        }
        GL15.glBindBuffer(GL21.GL_PIXEL_PACK_BUFFER, 0);

        pbosInitialised = true;
        System.out.println("[Loom Capture] PBOs created: " + captureWidth + "×" + captureHeight);
    }

    // ── Resolution helpers ────────────────────────────

    private int resolveWidth(MinecraftClient mc) {
        CaptureConfig.CaptureResolution res = CaptureConfig.getInstance().captureResolution;
        return res == CaptureConfig.CaptureResolution.MATCH
                ? mc.getWindow().getFramebufferWidth()
                : res.width;
    }

    private int resolveHeight(MinecraftClient mc) {
        CaptureConfig.CaptureResolution res = CaptureConfig.getInstance().captureResolution;
        return res == CaptureConfig.CaptureResolution.MATCH
                ? mc.getWindow().getFramebufferHeight()
                : res.height;
    }

    // ── Window resize detection ───────────────────────

    private void checkResolutionChange() {
        MinecraftClient mc = MinecraftClient.getInstance();
        int newW = resolveWidth(mc);
        int newH = resolveHeight(mc);
        if (newW != captureWidth || newH != captureHeight) {
            System.out.println("[Loom Capture] Resolution changed → recreating PBOs");
            destroyPbos();
            pbosInitialised = false;
            // Encoders need to be restarted too
            if (recording) {
                stopRecording();
                sendStatusMessage("§c[Loom] Recording stopped — window resized");
            }
            if (replayBufferActive) {
                stopReplayBuffer();
                startReplayBuffer();
            }
        }
    }

    // ── Frame capture (ping-pong PBO readback) ────────

    private void captureFrame() {
        CaptureConfig cfg = CaptureConfig.getInstance();
        if (!cfg.enabled) return;
        if (!recording && !replayBufferActive) return;

        // Frame-rate limiter
        long now = System.nanoTime();
        if (now - lastCaptureTimeNs < framePeriodNs) return;
        lastCaptureTimeNs = now;

        ensurePbos();
        checkResolutionChange();

        // ── Step 1: Start async readback into current PBO ──
        GL15.glBindBuffer(GL21.GL_PIXEL_PACK_BUFFER, pboIds[currentPbo]);
        GL11.glReadPixels(0, 0, captureWidth, captureHeight,
                GL11.GL_RGBA, GL11.GL_UNSIGNED_BYTE, 0);

        // ── Step 2: Read the OTHER PBO (completed from last frame) ──
        if (frameCount > 0) { // skip the very first frame — nothing to read yet
            int readPbo = 1 - currentPbo;
            GL15.glBindBuffer(GL21.GL_PIXEL_PACK_BUFFER, pboIds[readPbo]);
            ByteBuffer pixels = GL15.glMapBuffer(GL21.GL_PIXEL_PACK_BUFFER, GL15.GL_READ_ONLY);

            if (pixels != null) {
                byte[] frameData = new byte[captureWidth * captureHeight * 4];
                pixels.get(frameData);
                GL15.glUnmapBuffer(GL21.GL_PIXEL_PACK_BUFFER);

                // Feed to active encoders
                if (encoder != null && encoder.isRunning()) {
                    encoder.submitFrame(frameData);
                }
                if (replayEncoder != null && replayEncoder.isRunning()) {
                    replayEncoder.submitFrame(frameData);
                }
            }
        }

        GL15.glBindBuffer(GL21.GL_PIXEL_PACK_BUFFER, 0);
        currentPbo = 1 - currentPbo; // swap
        frameCount++;
    }

    // ── Recording start / stop ────────────────────────

    private void startRecording() {
        if (recording) return;
        CaptureConfig cfg = CaptureConfig.getInstance();

        ensurePbos();

        String timestamp = LocalDateTime.now()
                .format(DateTimeFormatter.ofPattern("yyyy-MM-dd_HH-mm-ss"));
        String outFile = Path.of(cfg.recordingsDir, "recording_" + timestamp + ".mp4").toString();

        encoder = new VideoEncoder(outFile, captureWidth, captureHeight,
                cfg.maxFps, cfg.recordingQuality.bitrateMbps);
        encoder.start();
        recording = true;
        recordingStartTime = System.currentTimeMillis();

        sendStatusMessage("§a[Loom] Recording started");
        System.out.println("[Loom Capture] Recording started → " + outFile);
    }

    private void stopRecording() {
        if (!recording) return;
        recording = false;

        if (encoder != null) {
            encoder.stop();
            encoder = null;
        }

        sendStatusMessage("§e[Loom] Recording saved");
        System.out.println("[Loom Capture] Recording stopped");
    }

    // ── Replay buffer start / stop / save ─────────────

    private void startReplayBuffer() {
        if (replayBufferActive) return;
        CaptureConfig cfg = CaptureConfig.getInstance();

        ensurePbos();

        replayEncoder = new VideoEncoder(
                replayTempDir,
                captureWidth, captureHeight,
                cfg.maxFps,
                cfg.recordingQuality.bitrateMbps,
                cfg.replayBufferSeconds,
                10 // 10-second segments
        );
        replayEncoder.start();
        replayBufferActive = true;

        System.out.println("[Loom Capture] Replay buffer started ("
                + cfg.replayBufferSeconds + "s)");
    }

    private void stopReplayBuffer() {
        if (!replayBufferActive) return;
        replayBufferActive = false;

        if (replayEncoder != null) {
            replayEncoder.stop();
            replayEncoder = null;
        }
    }

    /** Enable the always-on replay buffer. Called after init on the render thread. */
    public static void enableReplayBuffer() {
        if (instance == null) return;
        instance.startReplayBuffer();
    }

    private void doSaveReplayBuffer() {
        if (!replayBufferActive || replayEncoder == null) {
            sendStatusMessage("§c[Loom] Replay buffer not active");
            return;
        }

        CaptureConfig cfg = CaptureConfig.getInstance();

        // Save stops and then restarts the replay encoder
        String savedPath = replayEncoder.saveReplayBuffer(cfg.recordingsDir);

        if (savedPath != null) {
            sendStatusMessage("§a[Loom] Replay saved (" + cfg.replayBufferSeconds + "s)");

            // Restart replay buffer
            replayEncoder = new VideoEncoder(
                    replayTempDir,
                    captureWidth, captureHeight,
                    cfg.maxFps,
                    cfg.recordingQuality.bitrateMbps,
                    cfg.replayBufferSeconds,
                    10
            );
            replayEncoder.start();
            replayBufferActive = true;
        } else {
            sendStatusMessage("§c[Loom] Failed to save replay");
        }
    }

    // ── Shutdown ──────────────────────────────────────

    private void doShutdown() {
        recording = false;
        replayBufferActive = false;

        if (encoder != null) { encoder.stop(); encoder = null; }
        if (replayEncoder != null) { replayEncoder.stop(); replayEncoder = null; }

        destroyPbos();
        System.out.println("[Loom Capture] Shut down");
    }

    private void destroyPbos() {
        if (!pbosInitialised) return;
        GL15.glDeleteBuffers(pboIds);
        pboIds = new int[2];
        pbosInitialised = false;
    }

    // ── Helpers ───────────────────────────────────────

    private static void sendStatusMessage(String msg) {
        MinecraftClient mc = MinecraftClient.getInstance();
        if (mc.player != null) {
            mc.player.sendMessage(Text.literal(msg), true);
        }
    }
}
