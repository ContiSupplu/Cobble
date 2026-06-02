package com.cobble.dynamicisland;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Content filter for the in-game general browser.
 * Blocks adult content, dark web, malware, violence/extremism, and hacking sites.
 */
public class ContentFilter {

    /** Check if a URL should be blocked */
    public static boolean isBlocked(String url) {
        if (url == null || url.isEmpty()) return false;
        String lower = url.toLowerCase();

        // Block raw IP address navigation (bypass prevention)
        if (isRawIP(url)) return true;

        // Extract domain from URL
        String domain = extractDomain(lower);
        if (domain.isEmpty()) return false;

        // Block .onion (dark web)
        if (domain.endsWith(".onion")) return true;

        // Block known bad domains
        if (BLOCKED_DOMAINS.contains(domain)) return true;

        // Check parent domains (e.g., "sub.badsite.com" → check "badsite.com")
        String[] parts = domain.split("\\.");
        for (int i = 1; i < parts.length - 1; i++) {
            String parent = String.join(".", Arrays.copyOfRange(parts, i, parts.length));
            if (BLOCKED_DOMAINS.contains(parent)) return true;
        }

        // Pattern-based blocking
        for (Pattern pattern : BLOCKED_PATTERNS) {
            if (pattern.matcher(domain).find()) return true;
        }

        // Block certain URL paths
        for (String keyword : BLOCKED_PATH_KEYWORDS) {
            if (lower.contains(keyword)) return true;
        }

        return false;
    }

    /** Get a user-friendly block reason */
    public static String getBlockReason(String url) {
        if (url == null) return "Blocked";
        String lower = url.toLowerCase();
        String domain = extractDomain(lower);

        if (isRawIP(url)) return "Direct IP address navigation is blocked";
        if (domain.endsWith(".onion")) return "Dark web access is blocked";
        if (URL_SHORTENERS.contains(domain)) return "URL shorteners are blocked for safety";
        if (WEB_ARCHIVE_DOMAINS.contains(domain)) return "Web archive / cache bypass is blocked";

        // Check pattern categories
        for (Pattern p : PIRACY_PATTERNS) {
            if (p.matcher(domain).find()) return "Piracy-related content is blocked";
        }
        for (Pattern p : GAMBLING_PATTERNS) {
            if (p.matcher(domain).find()) return "Gambling content is blocked (age restriction)";
        }

        // Generic reason to avoid revealing filter specifics
        return "This site has been blocked by content filter";
    }

    // Block raw IP address navigation (bypass prevention)
    private static boolean isRawIP(String url) {
        try {
            java.net.URI uri = new java.net.URI(url);
            String host = uri.getHost();
            if (host == null) return false;
            // Match IPv4: digits and dots only
            return host.matches("^\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}$");
        } catch (Exception e) {
            return false;
        }
    }

    private static String extractDomain(String url) {
        try {
            String s = url;
            // Remove protocol
            int idx = s.indexOf("://");
            if (idx >= 0) s = s.substring(idx + 3);
            // Remove path
            idx = s.indexOf('/');
            if (idx >= 0) s = s.substring(0, idx);
            // Remove port
            idx = s.indexOf(':');
            if (idx >= 0) s = s.substring(0, idx);
            // Remove www prefix for matching
            if (s.startsWith("www.")) s = s.substring(4);
            return s;
        } catch (Exception e) {
            return "";
        }
    }

    // ── Domain Blocklist ──────────────────────────────
    // Comprehensive list of blocked domains by category

    private static final Set<String> BLOCKED_DOMAINS = new HashSet<>(Arrays.asList(
        // ─── Adult Content ───
        "pornhub.com", "xvideos.com", "xnxx.com", "xhamster.com",
        "redtube.com", "youporn.com", "tube8.com", "spankbang.com",
        "chaturbate.com", "stripchat.com", "bongacams.com", "livejasmin.com",
        "cam4.com", "myfreecams.com", "camsoda.com", "flirt4free.com",
        "brazzers.com", "bangbros.com", "realitykings.com", "naughtyamerica.com",
        "mofos.com", "digitalplayground.com", "wicked.com", "adulttime.com",
        "onlyfans.com", "fansly.com", "manyvids.com", "clips4sale.com",
        "porntrex.com", "eporner.com", "tnaflix.com", "drtuber.com",
        "txxx.com", "hclips.com", "pornone.com", "fuq.com",
        "beeg.com", "ixxx.com", "4tube.com", "sunporno.com",
        "porn.com", "sex.com", "xxx.com", "adult.com",
        "hentaihaven.xxx", "nhentai.net", "hanime.tv", "hentai.tv",
        "rule34.xxx", "rule34.paheal.net", "e621.net", "gelbooru.com",
        "danbooru.donmai.us", "sankakucomplex.com",
        "literotica.com", "asstr.org", "sexstories.com",
        "motherless.com", "heavy-r.com", "efukt.com",
        "omegle.com", "chatroulette.com",
        "backpage.com", "bedpage.com", "skipthegames.com",
        "ashleymadison.com", "adultfriendfinder.com",

        // ─── Malware / Phishing ───
        "malware-traffic-analysis.net",

        // ─── Extremism / Violence ───
        "stormfront.org", "dailystormer.name", "8kun.top",
        "4chan.org", "8chan.se", "kiwifarms.net",
        "thepiratebay.org", "1337x.to", "rarbg.to",

        // ─── Hacking / Exploit Sites ───
        "hackforums.net", "raidforums.com", "cracked.io",
        "nulled.to", "leakbase.io", "breachforums.is",
        "exploit-db.com", "0day.today",

        // ─── Dark Web Mirrors ───
        "darknetlive.com", "dark.fail",

        // ─── Illegal Marketplaces ───
        "silkroad.com",

        // ─── Gambling (underage protection) ───
        "stake.com", "roobet.com", "csgoroll.com",
        "gamdom.com", "rollbit.com"
    ));

    // ── URL Shorteners ─────────────────────────────────
    private static final Set<String> URL_SHORTENERS = new HashSet<>(Arrays.asList(
        "bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly",
        "is.gd", "buff.ly", "rebrand.ly", "cutt.ly", "shorturl.at", "tiny.cc"
    ));

    // ── Web Archive / Cache Bypass Domains ──────────────
    private static final Set<String> WEB_ARCHIVE_DOMAINS = new HashSet<>(Arrays.asList(
        "web.archive.org", "webcache.googleusercontent.com",
        "archive.org", "cached.google.com"
    ));

    // Add shorteners and archive domains to main blocklist at init
    static {
        BLOCKED_DOMAINS.addAll(URL_SHORTENERS);
        BLOCKED_DOMAINS.addAll(WEB_ARCHIVE_DOMAINS);
    }

    // Pattern-based blocking for domains containing these terms
    // Piracy-related patterns (used in getBlockReason too)
    private static final Pattern[] PIRACY_PATTERNS = new Pattern[] {
        Pattern.compile("\\btorrent\\b"),
        Pattern.compile("\\bpirat"),
        Pattern.compile("\\bcrack(ed|s|ing)?\\b"),
        Pattern.compile("\\bkeygen\\b"),
        Pattern.compile("\\bwarez\\b"),
    };

    // Gambling-related patterns (used in getBlockReason too)
    private static final Pattern[] GAMBLING_PATTERNS = new Pattern[] {
        Pattern.compile("\\bcasino\\b"),
        Pattern.compile("\\bbetting\\b"),
        Pattern.compile("\\bslots\\b"),
    };

    private static final Pattern[] BLOCKED_PATTERNS;
    static {
        java.util.List<Pattern> all = new java.util.ArrayList<>();
        // Adult / explicit
        all.add(Pattern.compile("\\bporn\\b"));
        all.add(Pattern.compile("\\bxxx\\b"));
        all.add(Pattern.compile("\\badult\\b"));
        all.add(Pattern.compile("\\bhentai\\b"));
        all.add(Pattern.compile("\\bnude[sz]?\\b"));
        all.add(Pattern.compile("\\bnaked\\b"));
        all.add(Pattern.compile("\\bescort[sz]?\\b"));
        all.add(Pattern.compile("\\bstrip(club)?\\b"));
        all.add(Pattern.compile("\\bcam(girl|boy|model)\\b"));
        // Dark web / hacking
        all.add(Pattern.compile("\\b(dark|deep)web\\b"));
        all.add(Pattern.compile("\\bhack(ing|er|tool)\\b"));
        all.add(Pattern.compile("\\bexploit\\b"));
        all.add(Pattern.compile("\\bphish(ing)?\\b"));
        all.add(Pattern.compile("\\bmalware\\b"));
        all.add(Pattern.compile("\\bransom(ware)?\\b"));
        all.add(Pattern.compile("\\.onion$"));
        // Piracy
        for (Pattern p : PIRACY_PATTERNS) all.add(p);
        // Gambling
        for (Pattern p : GAMBLING_PATTERNS) all.add(p);
        BLOCKED_PATTERNS = all.toArray(new Pattern[0]);
    }

    // Block URLs containing these path keywords
    private static final String[] BLOCKED_PATH_KEYWORDS = new String[] {
        "/nsfw", "/adult", "/xxx", "/porn",
        "/torrent", "/warez", "/crack", "/keygen",
    };
}
