package com.cobble.dynamicisland;

import net.minecraft.client.MinecraftClient;

import java.io.*;
import java.nio.file.*;
import java.util.Properties;

public class CaptureConfig {

    private static CaptureConfig instance;

    // ── Settings ──────────────────────────────────────
    public boolean enabled = true;
    public int replayBufferSeconds = 30;
    public RecordingQuality recordingQuality = RecordingQuality.HIGH;
    public CaptureResolution captureResolution = CaptureResolution.MATCH;
    public int maxFps = 30;
    public String ffmpegPath = "";
    public String recordingsDir = "";
    public boolean showRecordingIndicator = true;

    // ── Enums ─────────────────────────────────────────
    public enum RecordingQuality {
        LOW(2), MEDIUM(4), HIGH(8), ULTRA(16);

        public final int bitrateMbps;

        RecordingQuality(int bitrateMbps) {
            this.bitrateMbps = bitrateMbps;
        }
    }

    public enum CaptureResolution {
        MATCH(0, 0), P720(1280, 720), P1080(1920, 1080);

        public final int width;
        public final int height;

        CaptureResolution(int width, int height) {
            this.width = width;
            this.height = height;
        }
    }

    // ── Singleton ─────────────────────────────────────
    public static CaptureConfig getInstance() {
        if (instance == null) {
            instance = new CaptureConfig();
            instance.applyDefaults();
        }
        return instance;
    }

    private void applyDefaults() {
        // Auto-detect FFmpeg from system property, then PATH
        String sysProp = System.getProperty("loom.ffmpeg.path");
        if (sysProp != null && !sysProp.isBlank()) {
            ffmpegPath = sysProp;
        } else {
            ffmpegPath = findFfmpegOnPath();
        }

        // Default recordings directory: from launcher property or .minecraft/recordings/
        String recDir = System.getProperty("loom.recordings.dir");
        if (recDir != null && !recDir.isBlank()) {
            recordingsDir = recDir;
        } else {
            Path gameDir = MinecraftClient.getInstance().runDirectory.toPath();
            recordingsDir = gameDir.resolve("recordings").toString();
        }
    }

    private static String findFfmpegOnPath() {
        // Check common locations on Windows
        String[] candidates = {
            "ffmpeg",
            "C:\\ffmpeg\\bin\\ffmpeg.exe",
            System.getProperty("user.home") + "\\ffmpeg\\bin\\ffmpeg.exe"
        };
        for (String candidate : candidates) {
            try {
                Process p = new ProcessBuilder(candidate, "-version")
                        .redirectErrorStream(true)
                        .start();
                p.getInputStream().readAllBytes();
                int exit = p.waitFor();
                if (exit == 0) return candidate;
            } catch (Exception ignored) {}
        }
        return "ffmpeg"; // fall back to PATH lookup at runtime
    }

    // ── Persistence ───────────────────────────────────
    private static final String CONFIG_FILE = "config/loom-capture.properties";

    public static void load() {
        CaptureConfig cfg = getInstance();
        Path path = Path.of(CONFIG_FILE);
        if (!Files.exists(path)) return;

        try (InputStream in = Files.newInputStream(path)) {
            Properties props = new Properties();
            props.load(in);

            cfg.enabled = Boolean.parseBoolean(props.getProperty("enabled", "true"));
            cfg.replayBufferSeconds = Integer.parseInt(props.getProperty("replayBufferSeconds", "30"));
            cfg.recordingQuality = RecordingQuality.valueOf(props.getProperty("recordingQuality", "HIGH"));
            cfg.captureResolution = CaptureResolution.valueOf(props.getProperty("captureResolution", "MATCH"));
            cfg.maxFps = Integer.parseInt(props.getProperty("maxFps", "60"));
            cfg.showRecordingIndicator = Boolean.parseBoolean(props.getProperty("showRecordingIndicator", "true"));

            String savedFfmpeg = props.getProperty("ffmpegPath", "");
            if (!savedFfmpeg.isBlank()) cfg.ffmpegPath = savedFfmpeg;

            String savedDir = props.getProperty("recordingsDir", "");
            if (!savedDir.isBlank()) cfg.recordingsDir = savedDir;

            System.out.println("[Loom Capture] Config loaded");
        } catch (Exception e) {
            System.err.println("[Loom Capture] Failed to load config: " + e.getMessage());
        }
    }

    public static void save() {
        CaptureConfig cfg = getInstance();
        Path path = Path.of(CONFIG_FILE);

        try {
            Files.createDirectories(path.getParent());
            Properties props = new Properties();
            props.setProperty("enabled", String.valueOf(cfg.enabled));
            props.setProperty("replayBufferSeconds", String.valueOf(cfg.replayBufferSeconds));
            props.setProperty("recordingQuality", cfg.recordingQuality.name());
            props.setProperty("captureResolution", cfg.captureResolution.name());
            props.setProperty("maxFps", String.valueOf(cfg.maxFps));
            props.setProperty("ffmpegPath", cfg.ffmpegPath);
            props.setProperty("recordingsDir", cfg.recordingsDir);
            props.setProperty("showRecordingIndicator", String.valueOf(cfg.showRecordingIndicator));

            try (OutputStream out = Files.newOutputStream(path)) {
                props.store(out, "Loom Capture Settings");
            }
            System.out.println("[Loom Capture] Config saved");
        } catch (Exception e) {
            System.err.println("[Loom Capture] Failed to save config: " + e.getMessage());
        }
    }
}
