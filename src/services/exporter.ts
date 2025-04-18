import * as util from "util";
import * as child_process from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { config } from "../config.js";
import { uploadToSpaces } from "./spaces-uploader.js";
import { discordLogger } from "@/utils/logger.js";
import {
  generateUniqueChannelName,
  getChannelName,
  maskSensitiveInfo,
  sanitizeError,
} from "../utils/helpers.js";
import {
  CategoryChannel,
  Client,
  IntentsBitField,
  PermissionFlagsBits,
  TextChannel,
} from "discord.js";

const exec = util.promisify(child_process.exec);

// Get the current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define the archives path
const ARCHIVES_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "data",
  "archives"
);

/**
 * Logs a message to the log file
 * @param text The message to log
 */
const appendLog = async (text: string): Promise<void> => {
  const logPath = path.join(__dirname, "..", "..", "log.txt");

  try {
    let existingData = "";

    try {
      existingData = fs.readFileSync(logPath, "utf8");
    } catch (err) {
      // File doesn't exist yet, which is fine
    }

    // Mask sensitive information before logging
    const maskedText = maskSensitiveInfo(text);
    const newData = `${maskedText}${existingData ? "\n" + existingData : ""}`;
    fs.writeFileSync(logPath, newData, "utf8");
    console.log(maskedText); // Also log to console with masked info
  } catch (err) {
    console.error("Error writing to log file:", err);
  }
};

/**
 * Moves exported channel to the Valhalla channel category and notifies user that the export is complete
 * @param channelId The channel ID that was exported
 * @param guildId The guild ID of the channel
 * @param success Whether the export was successful
 */
const moveChannelToValhalla = async (
  channelId: string,
  guildId: string,
  success: boolean
): Promise<void> => {
  try {
    const client = new Client({
      intents: [IntentsBitField.Flags.Guilds],
    });

    await client.login(process.env.DISCORD_API_TOKEN);

    // Get the guild and channel
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      throw new Error(`Guild ${guildId} not found`);
    }

    const channel = (await guild.channels.fetch(channelId)) as
      | TextChannel
      | undefined;
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    if (!success) {
      await channel.send({
        embeds: [
          {
            title: "Channel Export Failed",
            description:
              "The export of this channel failed. Please try again later.",
            color: 0xff3864,
            timestamp: new Date().toISOString(),
          },
        ],
      });
      return;
    }

    await appendLog(
      `🟩 Initiating archival of channel ${channelId} in Valhalla channel category ${
        config.DISCORD_VALHALLA_CATEGORY_ID
      } - ${new Date().toISOString()}`
    );

    // Check permissions before attempting to move the channel
    if (!client.user) {
      throw new Error("Client user is null");
    }

    const botMember = guild.members.cache.get(client.user.id);
    if (!botMember) {
      throw new Error(`Bot member not found in guild ${guild.name}`);
    }

    const botPermissions = channel.permissionsFor(botMember);
    if (!botPermissions) {
      throw new Error(
        `Could not get permissions for bot in channel ${channel.name}`
      );
    }

    const targetCategory = (await guild.channels.fetch(
      config.DISCORD_VALHALLA_CATEGORY_ID
    )) as CategoryChannel;

    // Log detailed permission and role hierarchy information
    const permissionDetails = {
      channel: {
        name: channel.name,
        id: channel.id,
        type: channel.type,
        parentId: channel.parentId,
      },
      bot: {
        id: botMember.id,
        tag: botMember.user.tag,
        roles: botMember.roles.cache.map((r) => ({
          id: r.id,
          name: r.name,
          position: r.position,
        })),
        highestRole: {
          id: botMember.roles.highest.id,
          name: botMember.roles.highest.name,
          position: botMember.roles.highest.position,
        },
      },
      permissions: {
        administrator: botPermissions.has(PermissionFlagsBits.Administrator),
        manageChannels: botPermissions.has(PermissionFlagsBits.ManageChannels),
        manageGuild: botPermissions.has(PermissionFlagsBits.ManageGuild),
        viewChannel: botPermissions.has(PermissionFlagsBits.ViewChannel),
      },
      targetCategory: targetCategory
        ? {
            id: targetCategory.id,
            name: targetCategory.name,
            type: targetCategory.type,
          }
        : null,
      targetCategoryId: config.DISCORD_VALHALLA_CATEGORY_ID,
    };

    discordLogger(
      `Archive in Valhalla detailed permission check: ${JSON.stringify(
        permissionDetails,
        null,
        2
      )}`,
      client
    );

    // Check if we can move the channel
    if (!botPermissions.has(PermissionFlagsBits.ManageChannels)) {
      discordLogger(
        `Bot lacks MANAGE_CHANNELS permission for channel ${channel.name}`,
        client
      );

      await channel.send({
        embeds: [
          {
            title: "Channel Archival Failed",
            description: `Bot lacks MANAGE_CHANNELS permission for channel ${channel.name}`,
            color: 0xff3864,
            timestamp: new Date().toISOString(),
          },
        ],
      });
      return;
    }

    if (!targetCategory) {
      discordLogger(
        `Valhalla category not found: ${config.DISCORD_VALHALLA_CATEGORY_ID}`,
        client
      );

      await channel.send({
        embeds: [
          {
            title: "Channel Archival Failed",
            description: `Valhalla category not found: ${config.DISCORD_VALHALLA_CATEGORY_ID}`,
            color: 0xff3864,
            timestamp: new Date().toISOString(),
          },
        ],
      });
      return;
    }

    try {
      // Generate a unique name if needed
      const uniqueChannelName = generateUniqueChannelName(
        channel.name,
        targetCategory
      );
      const needsRename = uniqueChannelName !== channel.name;

      // Log the planned action
      discordLogger(
        `Attempting to move channel ${channel.name}${
          needsRename ? ` (will be renamed to ${uniqueChannelName})` : ""
        } to Valhalla category`,
        client
      );

      // First rename if necessary
      if (needsRename) {
        await channel.setName(uniqueChannelName);
        discordLogger(
          `Renamed channel from ${channel.name} to ${uniqueChannelName}`,
          client
        );
      }

      // Then move to Valhalla
      await channel.setParent(config.DISCORD_VALHALLA_CATEGORY_ID);

      discordLogger(
        `Successfully moved channel ${uniqueChannelName} to Valhalla category`,
        client
      );

      // Send a single message for successful archive and move
      await channel.send({
        embeds: [
          {
            title: "Channel Moved to Valhalla",
            description: `This channel has been moved to Valhalla${
              needsRename
                ? ` and renamed to ${uniqueChannelName} to avoid naming conflicts`
                : ""
            }! A backup has been created and can be accessed here: ${
              config.VALHALLA_SITE
            }`,
            color: 0xff3864,
            timestamp: new Date().toISOString(),
          },
        ],
      });
    } catch (moveError) {
      // Detailed error logging with sanitization
      interface ErrorWithCode extends Error {
        code?: number;
        httpStatus?: number;
        method?: string;
        path?: string;
      }

      const errorDetails = sanitizeError(moveError as ErrorWithCode);

      discordLogger(
        `Detailed error moving channel to Valhalla: ${JSON.stringify(
          errorDetails,
          null,
          2
        )}`,
        client
      );

      // Send a single message for archive but failed move
      await channel.send({
        embeds: [
          {
            title: "Channel Exported, but Not Moved to Valhalla",
            description: `A backup of this channel has been created and can be accessed here: ${config.VALHALLA_SITE}\n\nThis channel could not be moved to Valhalla due to an error: ${errorDetails.message}`,
            color: 0xff3864,
            timestamp: new Date().toISOString(),
          },
        ],
      });
    }

    await appendLog(
      `🟩 Exporting and archiving channel ${channelId} succeeded - ${new Date().toISOString()}`
    );
  } catch (error) {
    await appendLog(
      `🟥 Moving channel ${channelId} to Valhalla (archive) failed - ${new Date().toISOString()}`
    );
    console.error("Error in moveChannelToValhalla:", error);

    const client = new Client({
      intents: [IntentsBitField.Flags.Guilds],
    });

    await client.login(process.env.DISCORD_API_TOKEN);

    const errorDetails = sanitizeError(error);
    discordLogger(
      `Error in moveChannelToValhalla: ${JSON.stringify(
        errorDetails,
        null,
        2
      )}`,
      client
    );
  }
};

/**
 * Exports a Discord channel to HTML and uploads it to DigitalOcean Spaces
 * @param channelId The Discord channel ID to export
 * @param guildId The Discord guild ID of the channel
 */
export const exportChannel = async (
  channelId: string,
  guildId: string
): Promise<void> => {
  await appendLog(
    `🟩 Initiating export of channel ${channelId} in guild ${guildId} - ${new Date().toISOString()}`
  );

  try {
    // Create archives directory if it doesn't exist
    if (!fs.existsSync(ARCHIVES_PATH)) {
      fs.mkdirSync(ARCHIVES_PATH, { recursive: true });
    }

    const client = new Client({
      intents: [IntentsBitField.Flags.Guilds],
    });

    await client.login(process.env.DISCORD_API_TOKEN);

    // Get channel name for the file name
    const channelName = await getChannelName(client, channelId);

    // Generate a timestamp for the temporary file name
    const timestamp = new Date().toISOString().replace(/[:\.]/g, "-");
    const tempFileName = `${channelId}-${timestamp}.html`;
    const filePath = path.join(ARCHIVES_PATH, tempFileName);

    // Construct the Discord Chat Exporter command
    const command = `/opt/app/DiscordChatExporter.Cli export -t ${config.DISCORD_API_TOKEN} -c ${channelId} -f HtmlDark -o "${filePath}"`;

    // Log the command with masked sensitive information
    console.log(`Executing command: ${maskSensitiveInfo(command)}`);

    // Execute the command
    const { stdout, stderr } = await exec(command);

    if (stderr) {
      console.error("stderr:", stderr);
    }

    // Check if the export was successful
    if (stdout.includes("Successfully exported")) {
      await appendLog(
        `🟩 Successfully exported channel ${channelId} (${channelName}) - ${new Date().toISOString()}`
      );

      // Upload the file to DigitalOcean Spaces - pass the channel name
      await uploadToSpaces(filePath, channelName);

      // Move channel to Valhalla (archive) category
      await moveChannelToValhalla(channelId, guildId, true);

      return;
    } else {
      throw new Error(`Export failed: ${maskSensitiveInfo(stdout)}`);
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    await appendLog(
      `🟥 Failed to export channel ${channelId}: ${maskSensitiveInfo(
        errorMessage
      )} - ${new Date().toISOString()}`
    );

    // Notify channel about the failed export
    await moveChannelToValhalla(channelId, guildId, false);

    throw error;
  }
};
