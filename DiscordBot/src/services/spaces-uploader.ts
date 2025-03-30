import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import { config } from '../config';

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
 * Uploads a file to DigitalOcean Spaces
 * @param filePath Local path to the file
 * @param channelName Name of the Discord channel
 * @returns URL to the uploaded file
 */
export const uploadToSpaces = async (filePath: string, channelName: string): Promise<string> => {
  try {
    console.log(`Uploading ${filePath} to DigitalOcean Spaces...`);

    // Read the file content
    const fileContent = fs.readFileSync(filePath);
    
    // Use simple filename format: channelName.html
    const fileName = `${channelName}.html`;
    
    // Set up the upload parameters - upload directly to bucket root
    const params = {
      Bucket: config.DO_SPACES_BUCKET,
      Key: fileName,
      Body: fileContent,
      ACL: 'public-read',
      ContentType: 'text/html'
    };

    // Upload the file
    await s3Client.send(new PutObjectCommand(params));

    // Construct and return the URL to the uploaded file
    // Direct path to bucket root
    const spacesUrl = `https://${config.DO_SPACES_BUCKET}.${config.DO_SPACES_ENDPOINT?.replace('https://', '')}/${channelName}.html`;
    
    console.log(`File uploaded successfully to: ${spacesUrl}`);
    console.log('Config bucket:', config.DO_SPACES_BUCKET);
    console.log('Config endpoint:', config.DO_SPACES_ENDPOINT);
    console.log('Upload key:', params.Key);
    console.log('Generated URL:', spacesUrl);
    return spacesUrl;
  } catch (error) {
    console.error('Error uploading file to DigitalOcean Spaces:', error);
    throw error;
  }
};