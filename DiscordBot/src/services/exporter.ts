import * as util from 'util';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { config } from '../config';
import { uploadToSpaces } from './spaces-uploader';
import { Client, IntentsBitField } from 'discord.js';

const exec = util.promisify(child_process.exec);

// Get the current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define the archives path
const ARCHIVES_PATH = path.join(__dirname, '..', '..', '..', 'data', 'archives');

/**
 * Masks sensitive information in a string
 * @param text The text that might contain sensitive information
 * @returns The text with sensitive information masked
 */
const maskSensitiveInfo = (text: string): string => {
  if (!text) return text;
  
  // Create a copy to avoid modifying the original
  let maskedText = text;
  
  // Mask Discord tokens (typically in format: MTM1N...a8)
  maskedText = maskedText.replace(
    /(MT[A-Za-z0-9_-]{20,})\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27}/g, 
    '***DISCORD_TOKEN_MASKED***'
  );
  
  // Mask API keys for DO Spaces and other services
  maskedText = maskedText.replace(
    /([A-Za-z0-9]{20,})/g, 
    (match, p1, offset, string) => {
      // Skip replacing if it's part of a file path
      if (string.substr(Math.max(0, offset - 20), 40).includes('/')) {
        return match;
      }
      
      // Only mask if it looks like an API key or token
      if (/^[A-Za-z0-9+/=]{20,}$/.test(p1)) {
        return '***API_KEY_MASKED***';
      }
      
      return match;
    }
  );
  
  // Other sensitive info can be masked here
  
  return maskedText;
};

/**
 * Logs a message to the log file
 * @param text The message to log
 */
const appendLog = async (text: string): Promise<void> => {
  const logPath = path.join(__dirname, '..', '..', 'log.txt');
  
  try {
    let existingData = '';
    
    try {
      existingData = fs.readFileSync(logPath, 'utf8');
    } catch (err) {
      // File doesn't exist yet, which is fine
    }
    
    // Mask sensitive information before logging
    const maskedText = maskSensitiveInfo(text);
    const newData = `${maskedText}${existingData ? '\n' + existingData : ''}`;
    fs.writeFileSync(logPath, newData, 'utf8');
    console.log(maskedText); // Also log to console with masked info
  } catch (err) {
    console.error('Error writing to log file:', err);
  }
};

/**
 * Notifies the Dungeon Master bot that the export is complete
 * @param channelId The channel ID that was exported
 * @param guildId The guild ID of the channel
 * @param success Whether the export was successful
 * @param archiveUrl The URL to the exported archive in DigitalOcean Spaces
 */
const notifyDungeonMaster = async (
  channelId: string, 
  guildId: string, 
  success: boolean, 
  archiveUrl?: string
): Promise<void> => {
  try {
    await axios.post(config.DUNGEON_MASTER_CALLBACK_URL as string, {
      channelId,
      guildId,
      success,
      archiveUrl
    });
    
    await appendLog(`🟩 Callback to Dungeon Master successful for channel ${channelId} - ${new Date().toISOString()}`);
  } catch (error) {
    await appendLog(`🟥 Callback to Dungeon Master failed for channel ${channelId} - ${new Date().toISOString()}`);
    console.error('Error notifying Dungeon Master:', error);
  }
};

/**
 * Gets a channel name from Discord API
 * @param channelId The Discord channel ID 
 * @returns The channel name or default name if fetching fails
 */
const getChannelName = async (channelId: string): Promise<string> => {
  try {
    // Initialize Discord client
    const client = new Client({
      intents: [IntentsBitField.Flags.Guilds]
    });
    
    await client.login(config.DISCORD_API_TOKEN);
    
    // Fetch the channel
    const channel = await client.channels.fetch(channelId);
    const channelName = channel?.name || `channel-${channelId}`;
    
    // Destroy the client when done
    client.destroy();
    
    return channelName;
  } catch (error) {
    console.error('Error fetching channel name:', error);
    // Return a fallback name if we can't fetch the channel
    return `channel-${channelId}`;
  }
};

/**
 * Exports a Discord channel to HTML and uploads it to DigitalOcean Spaces
 * @param channelId The Discord channel ID to export
 * @param guildId The Discord guild ID of the channel
 */
export const exportChannel = async (channelId: string, guildId: string): Promise<void> => {
  await appendLog(`🟩 Initiating export of channel ${channelId} in guild ${guildId} - ${new Date().toISOString()}`);
  
  try {
    // Create archives directory if it doesn't exist
    if (!fs.existsSync(ARCHIVES_PATH)) {
      fs.mkdirSync(ARCHIVES_PATH, { recursive: true });
    }

    // Get channel name for the file name
    const channelName = await getChannelName(channelId);
    
    // Generate a timestamp for the temporary file name
    const timestamp = new Date().toISOString().replace(/[:\.]/g, '-');
    const tempFileName = `${channelId}-${timestamp}.html`;
    const filePath = path.join(ARCHIVES_PATH, tempFileName);

    // Construct the Discord Chat Exporter command
    const command = `/opt/app/DiscordChatExporter.Cli export -t ${config.DISCORD_API_TOKEN} -c ${channelId} -f HtmlDark -o "${filePath}"`;

    // Log the command with masked sensitive information
    console.log(`Executing command: ${maskSensitiveInfo(command)}`);

    // Execute the command
    const { stdout, stderr } = await exec(command);
    
    if (stderr) {
      console.error('stderr:', stderr);
    }

    // Check if the export was successful
    if (stdout.includes('Successfully exported')) {
      await appendLog(`🟩 Successfully exported channel ${channelId} (${channelName}) - ${new Date().toISOString()}`);
      
      // Upload the file to DigitalOcean Spaces - pass the channel name
      const spacesUrl = await uploadToSpaces(filePath, channelName);
      
      // Notify the Dungeon Master bot about the successful export
      await notifyDungeonMaster(channelId, guildId, true, spacesUrl);
      
      return;

    } else {
      throw new Error(`Export failed: ${maskSensitiveInfo(stdout)}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? 
      error.message : 
      'Unknown error';
    
    await appendLog(`🟥 Failed to export channel ${channelId}: ${maskSensitiveInfo(errorMessage)} - ${new Date().toISOString()}`);
    
    // Notify the Dungeon Master bot about the failed export
    await notifyDungeonMaster(channelId, guildId, false);
    
    throw error;
  }
};