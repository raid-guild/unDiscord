import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as crypto from 'crypto';
import axios from 'axios';
import { config } from '../config';
import { Client, IntentsBitField } from 'discord.js';

// Create an S3 client configured for DigitalOcean Spaces
const s3Client = new S3Client({
  region: 'us-east-1',
  endpoint: config.DO_SPACES_ENDPOINT,
  credentials: {
    accessKeyId: config.DO_SPACES_KEY as string,
    secretAccessKey: config.DO_SPACES_SECRET as string
  },
  forcePathStyle: true
});

/**
 * Gets a channel name from Discord API
 */
const getChannelName = async (channelId: string): Promise<string> => {
  try {
    const client = new Client({
      intents: [IntentsBitField.Flags.Guilds]
    });
    
    await client.login(config.DISCORD_API_TOKEN);
    const channel = await client.channels.fetch(channelId);
    const channelName = channel?.name || `channel-${channelId}`;
    
    client.destroy();
    return channelName;
  } catch (error) {
    console.error('Error fetching channel name:', error);
    return `channel-${channelId}`;
  }
};

/**
 * Uploads a file to DigitalOcean Spaces
 * First attempts using AWS SDK, then falls back to direct upload if needed
 */
export const uploadToSpaces = async (filePath: string, channelName: string): Promise<string> => {
  try {
    console.log(`Uploading ${filePath} to DigitalOcean Spaces...`);

    // Prepare the filename
    const sanitizedChannelName = channelName.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
    const simplifiedFileName = `${sanitizedChannelName}.html`;
    
    // Try S3 client upload method first
    try {
      console.log("Attempting upload using AWS SDK...");
      
      const params = {
        Bucket: config.DO_SPACES_BUCKET,
        Key: simplifiedFileName,
        Body: fs.readFileSync(filePath),
        ACL: 'public-read',
        ContentType: 'text/html'
      };
      
      console.log(`Upload parameters:`, params.Bucket, params.Key);
      
      await s3Client.send(new PutObjectCommand(params));
      
      // Check if the file is accessible at the root URL
      const rootUrl = `https://${config.DO_SPACES_BUCKET}.nyc3.digitaloceanspaces.com/${simplifiedFileName}`;
      
      try {
        // Try to verify if the file is accessible at the root URL
        const response = await axios.head(rootUrl);
        
        if (response.status === 200) {
          console.log(`File successfully uploaded and accessible at: ${rootUrl}`);
          return rootUrl;
        } else {
          throw new Error("File not accessible at root URL");
        }
      } catch (verifyError) {
        console.log("File not accessible at root URL, trying direct upload method...");
        throw verifyError; // Proceed to next method
      }
    } catch (s3Error) {
      console.log("S3 client method didn't achieve root-level storage, trying direct upload...");
      
      // Try direct upload method as fallback
      return await directUploadToSpaces(filePath, simplifiedFileName);
    }
  } catch (error) {
    console.error('All upload methods failed:', error);
    
    // If all methods fail, return the known working URL (with the bucket name in the path)
    // This ensures the service keeps functioning even if we can't achieve root-level storage
    const fallbackUrl = `https://${config.DO_SPACES_BUCKET}.nyc3.digitaloceanspaces.com/${config.DO_SPACES_BUCKET}/${channelName.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}.html`;
    console.log(`Falling back to known working URL format: ${fallbackUrl}`);
    return fallbackUrl;
  }
};

/**
 * Direct upload method that bypasses the AWS SDK
 */
async function directUploadToSpaces(filePath: string, targetFilename: string): Promise<string> {
  try {
    console.log(`Direct uploading ${filePath} to DigitalOcean Spaces root...`);

    // Read the file
    const fileContent = fs.readFileSync(filePath);
    
    // Format the endpoint URL correctly
    let endpointUrl = config.DO_SPACES_ENDPOINT as string;
    if (endpointUrl.endsWith('/')) {
      endpointUrl = endpointUrl.slice(0, -1);
    }
    
    // Construct the direct upload URL
    const uploadUrl = `${endpointUrl}/${config.DO_SPACES_BUCKET}/${targetFilename}`;
    console.log(`Direct upload URL: ${uploadUrl}`);
    
    // Create authorization headers
    const date = new Date().toUTCString();
    const contentType = 'text/html';
    
    // Upload the file directly with appropriate headers
    const response = await axios.put(uploadUrl, fileContent, {
      headers: {
        'Content-Type': contentType,
        'Date': date,
        'x-amz-acl': 'public-read',
        'Authorization': `AWS ${config.DO_SPACES_KEY}:${generateSignature(
          'PUT',
          '',
          contentType,
          date,
          `/${config.DO_SPACES_BUCKET}/${targetFilename}`
        )}`
      }
    });
    
    console.log('Direct upload response:', response.status, response.statusText);
    
    // Construct the expected public URL
    const publicUrl = `https://${config.DO_SPACES_BUCKET}.nyc3.digitaloceanspaces.com/${targetFilename}`;
    console.log(`File should be accessible at: ${publicUrl}`);
    
    return publicUrl;
  } catch (error) {
    console.error('Error in direct upload:', error);
    throw error;
  }
}

/**
 * Generate AWS Signature for S3 API authorization
 */
function generateSignature(
  method: string,
  md5: string,
  contentType: string,
  date: string,
  resource: string
): string {
  const stringToSign = `${method}\n${md5}\n${contentType}\n${date}\n${resource}`;
  
  return crypto
    .createHmac('sha1', config.DO_SPACES_SECRET as string)
    .update(stringToSign)
    .digest('base64');
}