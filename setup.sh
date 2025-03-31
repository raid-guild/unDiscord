#!/bin/bash

# Create base directory structure
echo "Creating directory structure..."
mkdir -p unDiscord/DiscordBot/src/services
mkdir -p unDiscord/DiscordBot/src/sql
mkdir -p unDiscord/data/archives
mkdir -p unDiscord/data/storage

# Copy files to correct locations
echo "Creating Dockerfile..."
cat > unDiscord/DiscordBot/Dockerfile << 'EOF'
FROM tyrrrz/discordchatexporter:stable

# Install required packages
RUN apk update && \
    apk upgrade && \
    apk add --update npm && \
    apk add --update nodejs && \
    apk add --update curl

# Working directory setup
WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm install

# Copy application code
COPY . .

# Expose port for the API
EXPOSE 8080

# Start the application in development mode
ENTRYPOINT ["npm", "run", "dev"]
EOF

echo "Creating services/exporter.ts..."
cat > unDiscord/DiscordBot/src/services/exporter.ts << 'EOF'
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

    // Get channel name for better logging
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
      
      // Upload the file to DigitalOcean Spaces
      const spacesUrl = await uploadToSpaces(filePath, tempFileName);
      
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
EOF

echo "Creating services/spaces-uploader.ts..."
cat > unDiscord/DiscordBot/src/services/spaces-uploader.ts << 'EOF'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import { config } from '../config';
import { Client, IntentsBitField } from 'discord.js';

// Create an S3 client configured for DigitalOcean Spaces
const s3Client = new S3Client({
  region: 'us-east-1', // DigitalOcean Spaces uses this region identifier
  endpoint: config.DO_SPACES_ENDPOINT,
  credentials: {
    accessKeyId: config.DO_SPACES_KEY as string,
    secretAccessKey: config.DO_SPACES_SECRET as string
  },
  // Fix for the hostname mismatch error
  forcePathStyle: true
});

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
 * Uploads a file to DigitalOcean Spaces
 * @param filePath Local path to the file
 * @param channelName Name of the channel for the filename
 * @returns URL to the uploaded file
 */
export const uploadToSpaces = async (filePath: string, channelName: string): Promise<string> => {
  try {
    console.log(`Uploading ${filePath} to DigitalOcean Spaces...`);

    // Read the file content
    const fileContent = fs.readFileSync(filePath);
    
    // Use simple filename format: channelName.html
    // Sanitize the channel name to ensure it's a valid filename
    const sanitizedChannelName = channelName.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
    const simplifiedFileName = `${sanitizedChannelName}.html`;
    
    // Set up the upload parameters - upload directly to bucket root
    const params = {
      Bucket: config.DO_SPACES_BUCKET,
      Key: simplifiedFileName, // Upload directly to the bucket root
      Body: fileContent,
      ACL: 'public-read',
      ContentType: 'text/html'
    };

    // Upload the file
    await s3Client.send(new PutObjectCommand(params));

    // Construct and return the URL to the uploaded file
    const spacesUrl = `${config.DO_SPACES_ENDPOINT}/${simplifiedFileName}`;
    
    console.log(`File uploaded successfully to: ${spacesUrl}`);
    return spacesUrl;
  } catch (error) {
    console.error('Error uploading file to DigitalOcean Spaces:', error);
    throw error;
  }
};
EOF

echo "Creating services/index.ts..."
cat > unDiscord/DiscordBot/src/services/index.ts << 'EOF'
export * from './exporter';
export * from './spaces-uploader';
EOF

echo "Creating .env.example file..."
cat > unDiscord/DiscordBot/.env.example << 'EOF'
# Discord Bot Configuration
DISCORD_API_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_GUILD_ID=your_guild_id

# DigitalOcean Spaces Configuration
DO_SPACES_KEY=your_spaces_key
DO_SPACES_SECRET=your_spaces_secret
DO_SPACES_ENDPOINT=https://nyc3.digitaloceanspaces.com
DO_SPACES_BUCKET=your_bucket_name

# Dungeon Master Bot Callback
DUNGEON_MASTER_CALLBACK_URL=https://your-dungeon-master-bot-endpoint.com/callback
EOF

# Create empty log file
touch unDiscord/DiscordBot/log.txt

# Create gitignore file
cat > unDiscord/DiscordBot/.gitignore << 'EOF'
node_modules
dist
.env
log.txt
EOF

echo "Creating package.json..."
cat > unDiscord/DiscordBot/package.json << 'EOF'
{
  "name": "undiscord-exporter",
  "version": "0.1.0",
  "description": "A Discord channel exporter service that produces HTML archives",
  "author": {
    "name": "RaidGuild"
  },
  "main": "index.js",
  "type": "module",
  "dependencies": {
    "@aws-sdk/client-s3": "^3.511.0",
    "axios": "^1.6.7",
    "discord.js": "^14.16.3",
    "dotenv": "^16.4.5",
    "express": "^4.18.2",
    "sqlite3": "^5.1.7"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.11.0",
    "tsup": "^8.0.1",
    "tsx": "^4.7.0",
    "typescript": "^5.3.3"
  },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx dist/index.ts",
    "build": "tsup src/index.ts --minify"
  }
}
EOF

echo "Creating docker-compose.yaml..."
cat > unDiscord/docker-compose.yaml << 'EOF'
version: '3'
services:
  discord-exporter:
    build: ./DiscordBot
    container_name: DiscordExporter
    ports:
      - "8080:8080"
    volumes:
      - ./data/archives:/data/archives
    environment:
      - DISCORD_API_TOKEN=${DISCORD_API_TOKEN}
      - DISCORD_CLIENT_ID=${DISCORD_CLIENT_ID}
      - DISCORD_GUILD_ID=${DISCORD_GUILD_ID}
      - DO_SPACES_KEY=${DO_SPACES_KEY}
      - DO_SPACES_SECRET=${DO_SPACES_SECRET}
      - DO_SPACES_ENDPOINT=${DO_SPACES_ENDPOINT}
      - DO_SPACES_BUCKET=${DO_SPACES_BUCKET}
      - DUNGEON_MASTER_CALLBACK_URL=${DUNGEON_MASTER_CALLBACK_URL}
EOF

echo "Creating tsconfig.json..."
cat > unDiscord/DiscordBot/tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "./src",
    "outDir": "./dist",
    "removeComments": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "strictNullChecks": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
EOF

echo "Creating config.ts..."
cat > unDiscord/DiscordBot/src/config.ts << 'EOF'
import dotenv from "dotenv";

dotenv.config();

const { 
  DISCORD_API_TOKEN, 
  DISCORD_CLIENT_ID, 
  DISCORD_GUILD_ID, 
  DO_SPACES_KEY,
  DO_SPACES_SECRET,
  DO_SPACES_ENDPOINT,
  DO_SPACES_BUCKET,
  DUNGEON_MASTER_CALLBACK_URL
} = process.env;

// Check for required environment variables
if (!DISCORD_API_TOKEN || !DISCORD_CLIENT_ID) {
  throw new Error("Missing Discord environment variables");
}

if (!DO_SPACES_KEY || !DO_SPACES_SECRET || !DO_SPACES_ENDPOINT || !DO_SPACES_BUCKET) {
  throw new Error("Missing DigitalOcean Spaces environment variables");
}

if (!DUNGEON_MASTER_CALLBACK_URL) {
  throw new Error("Missing Dungeon Master callback URL");
}

export const config = {
  DISCORD_API_TOKEN,
  DISCORD_CLIENT_ID,
  DISCORD_GUILD_ID,
  DO_SPACES_KEY,
  DO_SPACES_SECRET,
  DO_SPACES_ENDPOINT,
  DO_SPACES_BUCKET,
  DUNGEON_MASTER_CALLBACK_URL
};
EOF

echo "Creating index.ts..."
cat > unDiscord/DiscordBot/src/index.ts << 'EOF'
import express, { Request, Response } from 'express';
import { config } from './config';
import { exportChannel } from './services/exporter';

// Utility function to mask sensitive information in logs
const maskSensitiveInfo = (text: string): string => {
  if (!text) return text;
  
  // Create a copy to avoid modifying the original
  let maskedText = text;
  
  // Mask Discord tokens
  maskedText = maskedText.replace(
    /(MT[A-Za-z0-9_-]{20,})\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27}/g, 
    '***DISCORD_TOKEN_MASKED***'
  );
  
  // Mask API keys
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
  
  return maskedText;
};

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware to parse JSON bodies
app.use(express.json());

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'healthy' });
});

// Export channel endpoint
app.post('/export', async (req: Request, res: Response) => {
  try {
    const { channelId, guildId } = req.body;
    
    if (!channelId) {
      return res.status(400).json({ error: 'Missing channelId in request body' });
    }

    // Use the guild ID from the request or fall back to the environment variable
    const targetGuildId = guildId || config.DISCORD_GUILD_ID;
    
    if (!targetGuildId) {
      return res.status(400).json({ error: 'Missing guildId in request or environment' });
    }
    
    // Start the export process asynchronously
    res.status(202).json({ 
      message: 'Export started', 
      channelId, 
      guildId: targetGuildId 
    });
    
    // Process the export after sending the response
    await exportChannel(channelId, targetGuildId);
    
  } catch (error) {
    console.error('Error processing export request:', maskSensitiveInfo(error instanceof Error ? error.message : String(error)));
    // No need to send response here as we've already sent a 202
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
EOF

echo "Setup completed successfully!"
echo "To deploy the service, navigate to the unDiscord directory and run:"
echo "  1. cp DiscordBot/.env.example DiscordBot/.env"
echo "  2. Edit the .env file with your credentials"
echo "  3. docker-compose build"
echo "  4. docker-compose up -d"