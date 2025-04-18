import express, { Request, Response } from "express";
import { config } from "./config.js";
import { exportChannel } from "./services/exporter.js";
import { maskSensitiveInfo } from "./utils/helpers.js";

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware to parse JSON bodies
app.use(express.json());

// Health check endpoint
app.get("/health", (_: Request, res: Response) => {
  res.status(200).json({ status: "healthy" });
});

// Export channel endpoint
app.post("/export", async (req: Request, res: Response): Promise<void> => {
  try {
    const { channelId, guildId } = req.body;

    if (!channelId) {
      res.status(400).json({ error: "Missing channelId in request body" });
      return;
    }

    // Use the guild ID from the request or fall back to the environment variable
    const targetGuildId = guildId || config.DISCORD_GUILD_ID;

    if (!targetGuildId) {
      res
        .status(400)
        .json({ error: "Missing guildId in request or environment" });
      return;
    }

    // Start the export process asynchronously
    res.status(202).json({
      message: "Export started",
      channelId,
      guildId: targetGuildId,
    });

    // Process the export after sending the response
    await exportChannel(channelId, targetGuildId);
  } catch (error) {
    console.error(
      "Error processing export request:",
      maskSensitiveInfo(error instanceof Error ? error.message : String(error))
    );
    // No need to send response here as we've already sent a 202
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
