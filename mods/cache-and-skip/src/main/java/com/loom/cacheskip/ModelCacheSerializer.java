package com.loom.cacheskip;

import org.slf4j.Logger;

import java.io.*;
import java.util.*;

/**
 * Serializes and deserializes baked model data to/from a compact binary format.
 *
 * Binary format per model:
 *   [4 bytes] Model ID string length + [N bytes] Model ID
 *   [1 byte]  Flags (bit 0: ambientOcclusion, bit 1: gui3d, bit 2: sideLit)
 *   [4 bytes] Particle sprite ID length + [N bytes] Particle sprite ID
 *   [7 × quad lists] (one per Direction ordinal 0-5, plus null/general at index 6):
 *     [4 bytes] Quad count
 *     Per quad:
 *       [4 bytes] Vertex data length
 *       [N × 4 bytes] Vertex data (int array)
 *       [4 bytes] Tint index
 *       [1 byte]  Face direction ordinal (0-5, or -1 for null)
 *       [1 byte]  Shade flag
 *       [4 bytes] Sprite ID length + [N bytes] Sprite ID
 *
 * This only handles "simple" baked models (vanilla-style with static quad lists).
 * Custom BakedModel subclasses from mods are flagged and skipped during caching.
 */
public final class ModelCacheSerializer {

    private static final Logger LOGGER = CacheAndSkipMod.LOGGER;

    private ModelCacheSerializer() {}

    /**
     * Serialize model data to the output stream.
     * The data is a map from model identifier strings to serializable model representations.
     */
    public static void serialize(DataOutputStream dos, Map<String, Object> models) throws IOException {
        int written = 0;
        int skipped = 0;

        for (Map.Entry<String, Object> entry : models.entrySet()) {
            String modelId = entry.getKey();
            Object modelData = entry.getValue();

            if (modelData instanceof SerializableModel sm) {
                writeString(dos, modelId);

                // Flags
                int flags = 0;
                if (sm.useAmbientOcclusion) flags |= 1;
                if (sm.isGui3d) flags |= 2;
                if (sm.isSideLit) flags |= 4;
                dos.writeByte(flags);

                // Particle sprite
                writeString(dos, sm.particleSpriteId != null ? sm.particleSpriteId : "");

                // 7 quad lists (6 directions + general)
                for (int dir = 0; dir < 7; dir++) {
                    List<SerializableQuad> quads = sm.quadsByDirection[dir];
                    dos.writeInt(quads != null ? quads.size() : 0);
                    if (quads != null) {
                        for (SerializableQuad quad : quads) {
                            // Vertex data
                            dos.writeInt(quad.vertexData.length);
                            for (int v : quad.vertexData) {
                                dos.writeInt(v);
                            }
                            dos.writeInt(quad.tintIndex);
                            dos.writeByte(quad.faceOrdinal);
                            dos.writeBoolean(quad.shade);
                            writeString(dos, quad.spriteId != null ? quad.spriteId : "");
                        }
                    }
                }
                written++;
            } else {
                // Non-serializable model — write a skip marker
                writeString(dos, modelId);
                dos.writeByte(0xFF); // Skip marker
                skipped++;
            }
        }

        if (skipped > 0) {
            LOGGER.info("[CacheAndSkip] Serialized {} models, skipped {} non-standard models",
                    written, skipped);
        }
    }

    /**
     * Deserialize model data from the input stream.
     */
    public static Map<String, Object> deserialize(DataInputStream dis, int modelCount) throws IOException {
        Map<String, Object> models = new LinkedHashMap<>(modelCount * 2);

        for (int i = 0; i < modelCount; i++) {
            String modelId = readString(dis);
            int flagsOrMarker = dis.readUnsignedByte();

            if (flagsOrMarker == 0xFF) {
                // Skip marker — this model wasn't cached
                models.put(modelId, null); // null means "bake this normally"
                continue;
            }

            SerializableModel sm = new SerializableModel();
            sm.useAmbientOcclusion = (flagsOrMarker & 1) != 0;
            sm.isGui3d = (flagsOrMarker & 2) != 0;
            sm.isSideLit = (flagsOrMarker & 4) != 0;

            sm.particleSpriteId = readString(dis);
            if (sm.particleSpriteId.isEmpty()) sm.particleSpriteId = null;

            // 7 quad lists
            sm.quadsByDirection = new List[7];
            for (int dir = 0; dir < 7; dir++) {
                int quadCount = dis.readInt();
                List<SerializableQuad> quads = new ArrayList<>(quadCount);
                for (int q = 0; q < quadCount; q++) {
                    SerializableQuad quad = new SerializableQuad();
                    int vertexLen = dis.readInt();
                    quad.vertexData = new int[vertexLen];
                    for (int v = 0; v < vertexLen; v++) {
                        quad.vertexData[v] = dis.readInt();
                    }
                    quad.tintIndex = dis.readInt();
                    quad.faceOrdinal = dis.readByte();
                    quad.shade = dis.readBoolean();
                    quad.spriteId = readString(dis);
                    if (quad.spriteId.isEmpty()) quad.spriteId = null;
                    quads.add(quad);
                }
                sm.quadsByDirection[dir] = quads;
            }

            models.put(modelId, sm);
        }

        return models;
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static void writeString(DataOutputStream dos, String s) throws IOException {
        byte[] bytes = s.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        dos.writeInt(bytes.length);
        dos.write(bytes);
    }

    private static String readString(DataInputStream dis) throws IOException {
        int len = dis.readInt();
        if (len < 0 || len > 1024 * 1024) {
            throw new IOException("Invalid string length: " + len);
        }
        byte[] bytes = new byte[len];
        dis.readFully(bytes);
        return new String(bytes, java.nio.charset.StandardCharsets.UTF_8);
    }

    // ── Data Classes ────────────────────────────────────────────────────────

    /**
     * Intermediate representation of a BakedModel for serialization.
     * This is populated by the mixin when intercepting the bake output.
     */
    public static class SerializableModel {
        public boolean useAmbientOcclusion;
        public boolean isGui3d;
        public boolean isSideLit;
        public String particleSpriteId;
        @SuppressWarnings("unchecked")
        public List<SerializableQuad>[] quadsByDirection = new List[7];
    }

    /**
     * Intermediate representation of a BakedQuad for serialization.
     */
    public static class SerializableQuad {
        public int[] vertexData;
        public int tintIndex;
        public byte faceOrdinal; // Direction ordinal, or -1 for null
        public boolean shade;
        public String spriteId; // Identifier string for the sprite
    }
}
