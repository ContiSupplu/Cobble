package com.cobble.dynamicisland.protection;

import net.fabricmc.fabric.api.client.message.v1.ClientSendMessageEvents;
import net.minecraft.client.MinecraftClient;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;

import java.util.regex.Pattern;

/**
 * Chat safety system.
 * Warns players before they send messages that could be used against them
 * via Mojang's chat reporting system. Does NOT block messages — only warns.
 * Player can send on second Enter press.
 *
 * Note: Mojang's reports are human-reviewed, not automated keyword bans.
 * This system catches obvious patterns that are commonly mass-reported.
 */
public class ChatSafety {

    // Track if we're in "warned" state — next send goes through
    private static boolean warned = false;
    private static String warnedMessage = "";
    private static long warnedTime = 0;

    // Patterns that are commonly mass-reported (NOT a complete list — just high-risk)
    // These are intentionally broad to catch social engineering attempts
    private static final Pattern[] RISKY_PATTERNS = {
        // Threats (commonly reported category)
        Pattern.compile("(?i)\\b(i('?ll|\\s+will)|gonna|going\\s+to)\\s+(kill|hurt|attack|destroy|murder|harm)\\s+(you|ur|u)\\b"),
        // Self-harm related (commonly reported)
        Pattern.compile("(?i)\\b(kill\\s+(my|your)?self|kys|sui[c]ide)\\b"),
        // Doxxing threats
        Pattern.compile("(?i)\\b(i\\s+know\\s+(where|your)\\s+(you\\s+live|address|ip)|dox|doxx|swat)\\b"),
        // CSAM-related (extremely high risk for global ban)
        Pattern.compile("(?i)\\b(cp|child\\s+p)\\b"),
    };

    // Messages that griefers try to bait you into saying
    private static final Pattern[] BAIT_PATTERNS = {
        // "Say [X] in chat" social engineering
        Pattern.compile("(?i)\\b(type|say|write)\\s+['\"]"),
    };

    public static void init() {
        // Register chat interception
        ClientSendMessageEvents.ALLOW_CHAT.register(ChatSafety::onChatMessage);
        ClientSendMessageEvents.ALLOW_COMMAND.register(ChatSafety::onCommand);

        System.out.println("[LoomShield] Chat safety initialized");
    }

    /**
     * Called before a chat message is sent.
     * Returns false to block, true to allow.
     */
    private static boolean onChatMessage(String message) {
        // If this is the same message we already warned about, let it through
        if (warned && message.equals(warnedMessage) 
                && System.currentTimeMillis() - warnedTime < 15_000) {
            warned = false;
            warnedMessage = "";
            return true; // Player confirmed, send it
        }

        // Check for risky content
        for (Pattern pattern : RISKY_PATTERNS) {
            if (pattern.matcher(message).find()) {
                showWarning("This message could be reported to Mojang. Press Enter again to send.");
                warned = true;
                warnedMessage = message;
                warnedTime = System.currentTimeMillis();
                return false; // Block first attempt
            }
        }

        // Reset warned state for new messages
        warned = false;
        warnedMessage = "";
        return true;
    }

    /**
     * Called before a command is sent. Check /msg, /tell, /w, /r commands.
     */
    private static boolean onCommand(String command) {
        // Extract message portion from whisper commands
        String lower = command.toLowerCase();
        if (lower.startsWith("msg ") || lower.startsWith("tell ") 
                || lower.startsWith("w ") || lower.startsWith("r ")) {
            // Get the message part (after the username)
            String[] parts = command.split("\\s+", 3);
            if (parts.length >= 3) {
                String msgPart = parts[2];
                // Reuse the same check
                for (Pattern pattern : RISKY_PATTERNS) {
                    if (pattern.matcher(msgPart).find()) {
                        showWarning("This private message could be reported. Press Enter again to send.");
                        warned = true;
                        warnedMessage = command;
                        warnedTime = System.currentTimeMillis();
                        return false;
                    }
                }
            }
        }
        return true;
    }

    /**
     * Check incoming messages for social engineering bait.
     * Called from the DI mod's chat listener.
     */
    public static void checkIncomingMessage(String sender, String message) {
        for (Pattern pattern : BAIT_PATTERNS) {
            if (pattern.matcher(message).find()) {
                MinecraftClient client = MinecraftClient.getInstance();
                if (client.player != null) {
                    client.player.sendMessage(
                        Text.literal("§e🛡 Loom Shield: Be careful — someone may be trying to bait you into saying something reportable."),
                        false
                    );
                }
                return;
            }
        }
    }

    private static void showWarning(String message) {
        MinecraftClient client = MinecraftClient.getInstance();
        if (client.player != null) {
            client.player.sendMessage(
                Text.literal("§e⚠ Loom Shield: " + message),
                false
            );
        }
        LoomShield.logBlock("Chat Warning", "Risky message intercepted");
    }
}
