import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  _Object,
  ObjectCannedACL,
} from "@aws-sdk/client-s3";
import * as fs from "fs";
import { config } from "../config.js";

// Create an S3 client configured for DigitalOcean Spaces
const s3Client = new S3Client({
  region: "us-east-1", // DigitalOcean Spaces uses this region identifier
  endpoint: config.DO_SPACES_ENDPOINT,
  credentials: {
    accessKeyId: config.DO_SPACES_KEY as string,
    secretAccessKey: config.DO_SPACES_SECRET as string,
  },
  forcePathStyle: false,
});

/**
 * Finds the next available counter for a filename
 * @param baseName Base name for the file
 * @param bucket Bucket name
 * @returns Unique file name with counter
 */
const findNextAvailableCounter = async (
  baseName: string,
  bucket: string
): Promise<string> => {
  // First check if the base filename is available
  const baseFileName = `${baseName}.html`;

  try {
    // List objects with the prefix to find files with similar names
    const response = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: baseName,
      })
    );

    // If no objects found or empty response, return the base filename
    if (!response.Contents || response.Contents.length === 0) {
      return baseFileName;
    }

    // Extract existing files and look for pattern baseName-X.html
    const existingFiles = response.Contents.map(
      (item: _Object) => item.Key
    ).filter(
      (key: string | undefined): key is string =>
        key !== undefined && key.endsWith(".html")
    );

    if (!existingFiles.includes(baseFileName)) {
      return baseFileName;
    }

    // Find the highest counter
    let maxCounter = 0;
    const counterRegex = new RegExp(`^${baseName}-(\\d+)\\.html$`);

    existingFiles.forEach((filename: string) => {
      const match = filename.match(counterRegex);
      if (match && match[1]) {
        const counter = parseInt(match[1], 10);
        if (counter > maxCounter) {
          maxCounter = counter;
        }
      }
    });

    // Return filename with next counter
    return `${baseName}-${maxCounter + 1}.html`;
  } catch (error) {
    console.error("Error checking existing files:", error);
    // Fall back to using a random counter if we can't list objects
    const random = Math.floor(Math.random() * 10000);
    return `${baseName}-${random}.html`;
  }
};

/**
 * Uploads a file to DigitalOcean Spaces
 * @param filePath Local path to the file
 * @param channelName Name of the channel for the filename
 * @returns URL to the uploaded file
 */
export const uploadToSpaces = async (
  filePath: string,
  channelName: string
): Promise<string> => {
  try {
    console.log(`Uploading ${filePath} to DigitalOcean Spaces...`);

    // Read the file content
    const fileContent = fs.readFileSync(filePath);

    // Sanitize the channel name to ensure it's a valid filename base
    const sanitizedChannelName = channelName
      .replace(/[^a-z0-9-]/gi, "-")
      .toLowerCase();

    // Generate a unique filename with counter
    const uniqueFileName = await findNextAvailableCounter(
      sanitizedChannelName,
      config.DO_SPACES_BUCKET
    );

    console.log(`Generated unique filename: ${uniqueFileName}`);

    // Set up the upload parameters
    const params = {
      Bucket: config.DO_SPACES_BUCKET,
      Key: uniqueFileName,
      Body: fileContent,
      ACL: "private" as ObjectCannedACL,
      ContentType: "text/html",
    };

    console.log(`Upload parameters:`);
    console.log(`Bucket: ${params.Bucket}`);
    console.log(`Key: ${params.Key}`);

    // Upload the file
    await s3Client.send(new PutObjectCommand(params));

    // Construct the URL to match the actual storage path structure
    // in DigitalOcean Spaces
    const spacesUrl = `https://${config.DO_SPACES_BUCKET}.nyc3.digitaloceanspaces.com/${uniqueFileName}`;

    console.log(
      `File uploaded successfully, should be accessible at: ${spacesUrl}`
    );

    return spacesUrl;
  } catch (error) {
    console.error("Error uploading file to DigitalOcean Spaces:", error);
    throw error;
  }
};
