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
  DISCORD_COMMAND_CENTER_ID,
  DISCORD_VALHALLA_CATEGORY_ID,
  API_KEY,
} = process.env;

// Check for required environment variables
if (!DISCORD_API_TOKEN || !DISCORD_CLIENT_ID || !DISCORD_GUILD_ID) {
  throw new Error("Missing Discord environment variables");
}

if (!DISCORD_VALHALLA_CATEGORY_ID || !DISCORD_COMMAND_CENTER_ID) {
  throw new Error("Missing Discord channel IDs");
}

if (
  !DO_SPACES_KEY ||
  !DO_SPACES_SECRET ||
  !DO_SPACES_ENDPOINT ||
  !DO_SPACES_BUCKET
) {
  throw new Error("Missing DigitalOcean Spaces environment variables");
}

if (!API_KEY) {
  throw new Error("Missing API key");
}

export const config = {
  DISCORD_API_TOKEN,
  DISCORD_CLIENT_ID,
  DISCORD_GUILD_ID,
  DISCORD_COMMAND_CENTER_ID,
  DISCORD_VALHALLA_CATEGORY_ID,
  DO_SPACES_KEY,
  DO_SPACES_SECRET,
  DO_SPACES_ENDPOINT,
  DO_SPACES_BUCKET,
  API_KEY,
};
