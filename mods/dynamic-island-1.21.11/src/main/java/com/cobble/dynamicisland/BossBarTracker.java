package com.cobble.dynamicisland;

import net.minecraft.client.gui.hud.ClientBossBar;
import net.minecraft.entity.boss.BossBar;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Stores boss bar data from the mixin for the Dynamic Island HUD to render.
 */
public class BossBarTracker {

    public static final List<BossBarInfo> activeBars = new ArrayList<>();

    public static void update(Map<UUID, ClientBossBar> bars) {
        activeBars.clear();
        for (ClientBossBar bar : bars.values()) {
            activeBars.add(new BossBarInfo(
                bar.getName().getString(),
                bar.getPercent(),
                bar.getColor()
            ));
        }
    }

    public static class BossBarInfo {
        public final String name;
        public final float percent;
        public final BossBar.Color color;

        public BossBarInfo(String name, float percent, BossBar.Color color) {
            this.name = name;
            this.percent = percent;
            this.color = color;
        }

        public int getBarColor() {
            return switch (color) {
                case PINK -> 0xFFFF55FF;
                case BLUE -> 0xFF5555FF;
                case RED -> 0xFFFF5555;
                case GREEN -> 0xFF55FF55;
                case YELLOW -> 0xFFFFFF55;
                case PURPLE -> 0xFFAA00AA;
                case WHITE -> 0xFFFFFFFF;
            };
        }
    }
}
