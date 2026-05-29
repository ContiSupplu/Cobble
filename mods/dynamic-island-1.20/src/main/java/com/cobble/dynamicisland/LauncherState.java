package com.cobble.dynamicisland;

public class LauncherState {
    public String type;
    public SpotifyState spotify;
    public String time;
    public String notification;

    public static class SpotifyState {
        public boolean playing;
        public String title;
        public String artist;
        public float progress;    // 0.0 - 1.0
        public long duration;     // ms
        public String albumArt;   // URL to album art image
    }
}
