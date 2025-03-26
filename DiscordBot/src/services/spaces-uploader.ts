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
  }
});

/**
 * Uploads a file to DigitalOcean Spaces
 * @param filePath Local path to the file
 * @param fileName Desired name for the file in the Space
 * @returns URL to the uploaded file
 */
export const uploadToSpaces = async (filePath: string, fileName: string): Promise<string> => {
  try {
    console.log(`Uploading ${filePath} to DigitalOcean Spaces...`);

    // Read the file content
    const fileContent = fs.readFileSync(filePath);
    
    // Set up the upload parameters
    const params = {
      Bucket: config.DO_SPACES_BUCKET,
      Key: `discord-archives/${fileName}`,
      Body: fileContent,
      ACL: 'public-read',
      ContentType: 'text/html'
    };

    // Upload the file
    await s3Client.send(new PutObjectCommand(params));

    // Construct and return the URL to the uploaded file
    const spacesUrl = `https://${config.DO_SPACES_BUCKET}.${config.DO_SPACES_ENDPOINT?.replace('https://', '')}/discord-archives/${fileName}`;
    
    console.log(`File uploaded successfully to: ${spacesUrl}`);
    return spacesUrl;
  } catch (error) {
    console.error('Error uploading file to DigitalOcean Spaces:', error);
    throw error;
  }
};