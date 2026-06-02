package com.cobble.dynamicisland;

import java.io.*;
import java.nio.file.*;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.*;

/**
 * Wraps an FFmpeg child process for hardware-accelerated H.264 video encoding.
 * Raw RGBA frames are piped via stdin; FFmpeg encodes to MP4.
 * <p>
 * Uses NVENC / AMF / QSV when available, falls back to libx264 ultrafast.
 * Supports continuous recording and rolling replay-buffer modes.
 */
public class VideoEncoder {

    // ── Shared hardware-encoder cache ─────────────────
    private static String cachedEncoder = null;
    private static boolean encoderDetected = false;

    // ── Instance fields ───────────────────────────────
    private Process ffmpegProcess;
    private OutputStream ffmpegStdin;
    private final BlockingQueue<byte[]> frameQueue = new ArrayBlockingQueue<>(15);
    private Thread encoderThread;
    private volatile boolean running = false;

    private String outputPath; // mutable for replay restarts
    private final int width;
    private final int height;
    private final int fps;
    private final int bitrate; // Mbps

    // ── Replay-buffer segment fields ──────────────────
    private final boolean replayMode;
    private final int segmentDurationSec;
    private final int maxSegments;
    private final Path segmentDir;
    private final List<Path> segments = new ArrayList<>();
    private int segmentIndex = 0;
    private long segmentFrameCount = 0;
    private long segmentMaxFrames;

    // ── Constructors ──────────────────────────────────

    /** Normal (continuous) recording mode. */
    public VideoEncoder(String outputPath, int width, int height, int fps, int bitrateMbps) {
        this.outputPath = outputPath;
        this.width = width;
        this.height = height;
        this.fps = fps;
        this.bitrate = bitrateMbps;
        this.replayMode = false;
        this.segmentDurationSec = 0;
        this.maxSegments = 0;
        this.segmentDir = null;
        this.segmentMaxFrames = 0;
    }

    /**
     * Replay-buffer mode — writes rolling segments to {@code segmentDir}.
     */
    public VideoEncoder(Path segmentDir, int width, int height, int fps,
                        int bitrateMbps, int bufferSeconds, int segmentDurationSec) {
        this.segmentDir = segmentDir;
        this.width = width;
        this.height = height;
        this.fps = fps;
        this.bitrate = bitrateMbps;
        this.replayMode = true;
        this.segmentDurationSec = segmentDurationSec;
        this.maxSegments = (int) Math.ceil((double) bufferSeconds / segmentDurationSec);
        this.segmentMaxFrames = (long) fps * segmentDurationSec;
        this.segmentIndex = 0;
        this.segments.clear();
        this.segmentFrameCount = 0;
        this.outputPath = nextSegmentPath();
    }

    // ── Lifecycle ─────────────────────────────────────

    public void start() {
        if (running) return;
        running = true;
        frameQueue.clear();
        spawnFfmpeg(outputPath);

        encoderThread = new Thread(this::encoderLoop, "Loom-Encoder");
        encoderThread.setDaemon(true);
        encoderThread.start();
        System.out.println("[Loom Capture] Encoder started → " + (replayMode ? "replay-buffer" : outputPath));
    }

    public void submitFrame(byte[] rgbaData) {
        if (!running) return;
        // Drop frame if queue is full (back-pressure) — don't block render thread
        frameQueue.offer(rgbaData);
    }

    public void stop() {
        if (!running) return;
        running = false;

        if (encoderThread != null) encoderThread.interrupt();
        closeFfmpeg();

        // Add the final segment if in replay mode
        if (replayMode && segmentFrameCount > 0) {
            segments.add(Path.of(outputPath));
        }

        System.out.println("[Loom Capture] Encoder stopped");
    }

    public boolean isRunning() {
        return running;
    }

    // ── Replay-buffer save ────────────────────────────

    public String saveReplayBuffer(String recordingsDir) {
        if (!replayMode) return null;

        stop(); // flush current segment

        if (segments.isEmpty()) {
            System.out.println("[Loom Capture] No replay segments to save");
            return null;
        }

        String timestamp = LocalDateTime.now()
                .format(DateTimeFormatter.ofPattern("yyyy-MM-dd_HH-mm-ss"));
        Path outPath = Path.of(recordingsDir, "replay_" + timestamp + ".mp4");

        try {
            Files.createDirectories(outPath.getParent());
            concatenateSegments(new ArrayList<>(segments), outPath);
            System.out.println("[Loom Capture] Replay saved → " + outPath);

            // Clean up temp segments
            for (Path seg : segments) {
                try { Files.deleteIfExists(seg); } catch (Exception ignored) {}
            }
            segments.clear();

            // Reset segment state for next recording cycle
            segmentIndex = 0;
            segmentFrameCount = 0;
            outputPath = nextSegmentPath();

            return outPath.toString();
        } catch (Exception e) {
            System.err.println("[Loom Capture] Failed to save replay: " + e.getMessage());
            e.printStackTrace();
            return null;
        }
    }

    private void concatenateSegments(List<Path> segs, Path output) throws Exception {
        Path listFile = segmentDir.resolve("concat_list.txt");
        StringBuilder sb = new StringBuilder();
        for (Path seg : segs) {
            sb.append("file '").append(seg.toAbsolutePath().toString().replace("\\", "/")).append("'\n");
        }
        Files.writeString(listFile, sb.toString());

        String ffmpeg = CaptureConfig.getInstance().ffmpegPath;
        ProcessBuilder pb = new ProcessBuilder(
                ffmpeg, "-y",
                "-f", "concat", "-safe", "0",
                "-i", listFile.toAbsolutePath().toString(),
                "-c", "copy",
                "-movflags", "+faststart",
                output.toAbsolutePath().toString()
        );
        pb.redirectErrorStream(true);
        Process p = pb.start();
        String out = new String(p.getInputStream().readAllBytes());
        int exit = p.waitFor();
        Files.deleteIfExists(listFile);
        if (exit != 0) {
            throw new IOException("FFmpeg concat exited with code " + exit + ": " + out);
        }
    }

    // ── Encoder thread ────────────────────────────────

    private void encoderLoop() {
        try {
            while (running) {
                byte[] frame = frameQueue.take();

                if (replayMode) {
                    segmentFrameCount++;
                    if (segmentFrameCount >= segmentMaxFrames) {
                        rotateSegment();
                    }
                }

                try {
                    if (ffmpegStdin != null) {
                        ffmpegStdin.write(frame);
                    }
                } catch (IOException e) {
                    System.err.println("[Loom Capture] Write to FFmpeg failed: " + e.getMessage());
                    running = false;
                }
            }
        } catch (InterruptedException ignored) {
            // Normal shutdown
        }
    }

    private void rotateSegment() {
        closeFfmpeg();
        segments.add(Path.of(outputPath));

        while (segments.size() > maxSegments) {
            Path old = segments.remove(0);
            try { Files.deleteIfExists(old); } catch (Exception ignored) {}
        }

        segmentIndex++;
        segmentFrameCount = 0;
        outputPath = nextSegmentPath();
        spawnFfmpeg(outputPath);
    }

    private String nextSegmentPath() {
        return segmentDir.resolve("seg_" + segmentIndex + ".mp4").toAbsolutePath().toString();
    }

    // ── FFmpeg process management ─────────────────────

    private void spawnFfmpeg(String outFile) {
        try {
            String[] cmd = buildFFmpegCommand(outFile);
            ProcessBuilder pb = new ProcessBuilder(cmd);
            pb.redirectErrorStream(true);
            ffmpegProcess = pb.start();
            ffmpegStdin = ffmpegProcess.getOutputStream();

            Thread drain = new Thread(() -> {
                try { ffmpegProcess.getInputStream().readAllBytes(); } catch (Exception ignored) {}
            }, "Loom-FFmpeg-Drain");
            drain.setDaemon(true);
            drain.start();
        } catch (Exception e) {
            System.err.println("[Loom Capture] Failed to spawn FFmpeg: " + e.getMessage());
            running = false;
        }
    }

    private void closeFfmpeg() {
        try {
            if (ffmpegStdin != null) {
                ffmpegStdin.close();
                ffmpegStdin = null;
            }
            if (ffmpegProcess != null) {
                ffmpegProcess.waitFor(5, TimeUnit.SECONDS);
                if (ffmpegProcess.isAlive()) ffmpegProcess.destroyForcibly();
                ffmpegProcess = null;
            }
        } catch (Exception e) {
            System.err.println("[Loom Capture] Error closing FFmpeg: " + e.getMessage());
        }
    }

    // ── FFmpeg command builder ────────────────────────

    private String[] buildFFmpegCommand(String outFile) {
        String ffmpeg = CaptureConfig.getInstance().ffmpegPath;
        String encoder = detectHardwareEncoder(ffmpeg);

        List<String> cmd = new ArrayList<>();
        cmd.add(ffmpeg);
        cmd.addAll(List.of("-y",
                "-f", "rawvideo",
                "-pix_fmt", "rgba",
                "-s", width + "x" + height,
                "-r", String.valueOf(fps),
                "-i", "pipe:0",
                "-vf", "vflip"));

        switch (encoder) {
            case "h264_nvenc" -> cmd.addAll(List.of(
                    "-c:v", "h264_nvenc", "-preset", "p1", "-tune", "ll",
                    "-rc", "vbr", "-cq", "28"));
            case "h264_amf" -> cmd.addAll(List.of(
                    "-c:v", "h264_amf", "-quality", "speed", "-rc", "vbr_latency"));
            case "h264_qsv" -> cmd.addAll(List.of(
                    "-c:v", "h264_qsv", "-preset", "veryfast"));
            default -> cmd.addAll(List.of(
                    "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
                    "-crf", "28"));
        }

        cmd.addAll(List.of(
                "-b:v", bitrate + "M",
                "-maxrate", (bitrate * 2) + "M",
                "-bufsize", (bitrate * 4) + "M",
                "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
                outFile));

        System.out.println("[Loom Capture] FFmpeg cmd: " + String.join(" ", cmd));
        return cmd.toArray(String[]::new);
    }

    // ── Hardware encoder detection ────────────────────

    public static String detectHardwareEncoder(String ffmpegPath) {
        if (encoderDetected) return cachedEncoder;

        String[] preferred = {"h264_nvenc", "h264_amf", "h264_qsv"};

        try {
            ProcessBuilder pb = new ProcessBuilder(ffmpegPath, "-hide_banner", "-encoders");
            pb.redirectErrorStream(true);
            Process p = pb.start();
            String output = new String(p.getInputStream().readAllBytes());
            p.waitFor(5, TimeUnit.SECONDS);

            for (String enc : preferred) {
                if (output.contains(enc)) {
                    cachedEncoder = enc;
                    encoderDetected = true;
                    System.out.println("[Loom Capture] Detected hardware encoder: " + enc);
                    return enc;
                }
            }
        } catch (Exception e) {
            System.err.println("[Loom Capture] Encoder detection failed: " + e.getMessage());
        }

        cachedEncoder = "libx264";
        encoderDetected = true;
        System.out.println("[Loom Capture] Using software encoder: libx264");
        return cachedEncoder;
    }
}
