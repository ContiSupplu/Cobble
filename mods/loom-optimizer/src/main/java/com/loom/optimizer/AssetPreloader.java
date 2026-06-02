package com.loom.optimizer;

import net.fabricmc.loader.api.FabricLoader;
import org.slf4j.Logger;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Asset Pre-loader — warms the OS page cache by sequentially reading all asset files
 * (textures, sounds, models, etc.) from the Minecraft assets directory.
 *
 * When Minecraft later needs these files, they're already in RAM (page cache) instead of
 * requiring disk I/O, which can save several seconds on HDD and even noticeable time on SSD.
 *
 * Uses a flag file (.loom-precached) to avoid re-doing this work if the assets directory
 * hasn't changed since the last run.
 */
public final class AssetPreloader {

    private static final Logger LOGGER = LoomOptimizerMod.LOGGER;
    private static final AtomicBoolean running = new AtomicBoolean(false);
    private static final AtomicBoolean completed = new AtomicBoolean(false);

    // Small buffer — we just need to touch every page (4KB pages on most OSes)
    private static final int BUFFER_SIZE = 8192;

    private AssetPreloader() {}

    /**
     * Starts the asset pre-loading on a daemon thread. Safe to call multiple times;
     * subsequent calls are no-ops if already running or completed.
     */
    public static void start() {
        if (!running.compareAndSet(false, true)) {
            LOGGER.info("[AssetPreloader] Already running or completed, skipping");
            return;
        }

        Thread thread = new Thread(AssetPreloader::run, "LoomOptimizer-AssetPreloader");
        thread.setDaemon(true);
        thread.setPriority(Thread.MIN_PRIORITY); // Don't compete with game threads
        thread.start();
        LOGGER.info("[AssetPreloader] Background pre-load thread started");
    }

    public static boolean isCompleted() {
        return completed.get();
    }

    private static void run() {
        long startTime = System.nanoTime();

        try {
            // Find the .minecraft directory (game directory)
            Path gameDir = FabricLoader.getInstance().getGameDir();
            Path assetsDir = gameDir.resolve("assets");

            if (!Files.isDirectory(assetsDir)) {
                // Try parent — sometimes gameDir is an instance folder and assets are in .minecraft
                Path dotMinecraft = gameDir.getParent();
                if (dotMinecraft != null) {
                    assetsDir = dotMinecraft.resolve("assets");
                }
            }

            if (!Files.isDirectory(assetsDir)) {
                LOGGER.warn("[AssetPreloader] Assets directory not found at {}, skipping pre-load", assetsDir);
                completed.set(true);
                return;
            }

            // Check flag file — skip if assets haven't changed
            Path flagFile = gameDir.resolve(".loom-precached");
            String currentHash = computeDirectoryHash(assetsDir);

            if (Files.exists(flagFile)) {
                try {
                    String savedHash = Files.readString(flagFile).trim();
                    if (savedHash.equals(currentHash)) {
                        LOGGER.info("[AssetPreloader] Assets unchanged (hash={}), skipping pre-load", currentHash);
                        completed.set(true);
                        return;
                    }
                } catch (IOException e) {
                    // Flag file corrupted, just re-do the pre-load
                }
            }

            LOGGER.info("[AssetPreloader] Starting page cache warming for {}", assetsDir);

            AtomicInteger fileCount = new AtomicInteger(0);
            AtomicInteger errorCount = new AtomicInteger(0);
            long[] totalBytes = {0};

            Files.walkFileTree(assetsDir, new SimpleFileVisitor<>() {
                final byte[] buffer = new byte[BUFFER_SIZE];

                @Override
                public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
                    try (InputStream in = Files.newInputStream(file)) {
                        // Read entire file — this loads it into the OS page cache
                        long size = 0;
                        int bytesRead;
                        while ((bytesRead = in.read(buffer)) != -1) {
                            size += bytesRead;
                        }
                        totalBytes[0] += size;
                        fileCount.incrementAndGet();
                    } catch (IOException e) {
                        errorCount.incrementAndGet();
                        // Don't log every error — just count them
                    }
                    return FileVisitResult.CONTINUE;
                }

                @Override
                public FileVisitResult visitFileFailed(Path file, IOException exc) {
                    errorCount.incrementAndGet();
                    return FileVisitResult.CONTINUE;
                }
            });

            // Write the flag file so we skip next time if assets haven't changed
            try {
                Files.writeString(flagFile, currentHash);
            } catch (IOException e) {
                LOGGER.warn("[AssetPreloader] Failed to write flag file: {}", e.getMessage());
            }

            double elapsed = (System.nanoTime() - startTime) / 1_000_000_000.0;
            double totalMB = totalBytes[0] / (1024.0 * 1024.0);
            LOGGER.info("[AssetPreloader] Pre-cached {} files ({:.1f} MB) in {:.2f}s ({} errors)",
                    fileCount.get(), totalMB, elapsed, errorCount.get());

        } catch (Exception e) {
            LOGGER.error("[AssetPreloader] Failed during pre-load", e);
        } finally {
            completed.set(true);
        }
    }

    /**
     * Computes a lightweight hash of the assets directory structure.
     * We hash the list of file paths + sizes (not contents — that would be too slow).
     * This lets us detect when assets are added, removed, or updated.
     */
    private static String computeDirectoryHash(Path assetsDir) {
        try {
            MessageDigest md = MessageDigest.getInstance("MD5");
            Files.walkFileTree(assetsDir, new SimpleFileVisitor<>() {
                @Override
                public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
                    String entry = assetsDir.relativize(file).toString() + ":" + attrs.size();
                    md.update(entry.getBytes());
                    return FileVisitResult.CONTINUE;
                }

                @Override
                public FileVisitResult visitFileFailed(Path file, IOException exc) {
                    return FileVisitResult.CONTINUE;
                }
            });
            byte[] digest = md.digest();
            StringBuilder sb = new StringBuilder();
            for (byte b : digest) {
                sb.append(String.format("%02x", b & 0xff));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException | IOException e) {
            // Fallback — always re-do pre-load
            return "unknown-" + System.currentTimeMillis();
        }
    }
}
