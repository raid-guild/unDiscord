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