import {
  CategoryChannel,
  Client,
  DiscordAPIError,
  GuildChannel,
  TextChannel,
} from "discord.js";

/**
 * Masks sensitive information in a string
 * @param text The text that might contain sensitive information
 * @returns The text with sensitive information masked
 */
export const maskSensitiveInfo = (text: string): string => {
  if (!text) return text;

  // Create a copy to avoid modifying the original
  let maskedText = text;

  // Mask Discord tokens (typically in format: MTM1N...a8)
  maskedText = maskedText.replace(
    /(MT[A-Za-z0-9_-]{20,})\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27}/g,
    "***DISCORD_TOKEN_MASKED***"
  );

  // Mask API keys for DO Spaces and other services
  maskedText = maskedText.replace(
    /([A-Za-z0-9]{20,})/g,
    (match, p1, offset, string) => {
      // Skip replacing if it's part of a file path
      if (string.substr(Math.max(0, offset - 20), 40).includes("/")) {
        return match;
      }

      // Only mask if it looks like an API key or token
      if (/^[A-Za-z0-9+/=]{20,}$/.test(p1)) {
        return "***API_KEY_MASKED***";
      }

      return match;
    }
  );

  // Other sensitive info can be masked here

  return maskedText;
};

/**
 * Generates a unique channel name in case of duplicates
 * @param name The original channel name
 * @param category The Valhalla category channel
 * @returns A unique channel name
 */
export const generateUniqueChannelName = (
  name: string,
  category: CategoryChannel
) => {
  // Get all channels in the Valhalla category
  const valhallaChannels = category.children.cache;

  // Check if there's already a channel with this name
  if (!valhallaChannels.some((ch: GuildChannel) => ch.name === name)) {
    return name; // No duplicate, return original name
  }

  // Find a unique name by appending a number
  let counter = 1;
  let newNameCandidate = `${name}-${counter}`;

  // Create an array of existing channel names for easier checking
  const existingNames = Array.from(valhallaChannels.values()).map(
    (ch) => ch.name
  );

  // Keep incrementing counter until we find an unused name
  while (existingNames.includes(newNameCandidate)) {
    counter += 1;
    newNameCandidate = `${name}-${counter}`;
  }

  return newNameCandidate;
};

interface SanitizedErrorDetails {
  message: string;
  name: string;
  type: string;
  code: string | number;
  stack?: string;
}

/**
 * Safely sanitize errors
 * @param error The error to sanitize
 * @returns Sanitized error details
 */
export const sanitizeError = (error: unknown): SanitizedErrorDetails => {
  const discordError = error as DiscordAPIError;
  return {
    message: error instanceof Error ? error.message : String(error),
    name: error instanceof Error ? error.name : "Unknown",
    type: typeof error,
    code: discordError.code,
    stack: error instanceof Error ? error.stack : undefined,
  };
};

/**
 * Gets a channel name from Discord API
 * @param channelId The Discord channel ID
 * @returns The channel name or default name if fetching fails
 */
export const getChannelName = async (
  client: Client,
  channelId: string
): Promise<string> => {
  try {
    // Fetch the channel
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      throw new Error("Channel not found or not a text channel");
    }
    const channelName = (channel as TextChannel).name || `channel-${channelId}`;

    // Destroy the client when done
    client.destroy();

    return channelName;
  } catch (error) {
    console.error("Error fetching channel name:", error);
    // Return a fallback name if we can't fetch the channel
    return `channel-${channelId}`;
  }
};
