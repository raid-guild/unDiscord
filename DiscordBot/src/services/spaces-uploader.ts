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
  forcePathStyle: true // Keep this true for upload, we'll handle URL construction separately
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
 * 
 * NOTE: For DigitalOcean Spaces, files are actually stored with the pattern:
 * {bucketName}/{bucketName}/{fileName} rather than just {bucketName}/{fileName}
 * This is accounted for in the URL construction.
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
    
    // Set up the upload parameters
    // IMPORTANT: Since the file is actually being stored at {bucketName}/{bucketName}/filename
    // We need to remove this prefix from the Key to get the file in the root
    const params = {
      Bucket: config.DO_SPACES_BUCKET,
      // Specify the full path minus the bucket name prefix to get it in the root
      Key: simplifiedFileName,
      Body: fileContent,
      ACL: 'public-read',
      ContentType: 'text/html'
    };
    
    console.log(`Upload parameters:`);
    console.log(`Bucket: ${params.Bucket}`);
    console.log(`Key: ${params.Key}`);

    // Upload the file
    await s3Client.send(new PutObjectCommand(params));

    // IMPORTANT: Construct the URL to match the actual storage path structure
    // in DigitalOcean Spaces
    // Since files are actually stored at {bucketName}/{bucketName}/file, we need to include the path
    const spacesUrl = `https://${config.DO_SPACES_BUCKET}.nyc3.digitaloceanspaces.com/${config.DO_SPACES_BUCKET}/${simplifiedFileName}`;
    
    console.log(`File uploaded successfully, should be accessible at: ${spacesUrl}`);
    
    return spacesUrl;
  } catch (error) {
    console.error('Error uploading file to DigitalOcean Spaces:', error);
    throw error;
  }
};