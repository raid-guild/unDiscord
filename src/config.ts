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
  DUNGEON_MASTER_CALLBACK_URL,
} = process.env;

// Check for required environment variables
if (!DISCORD_API_TOKEN || !DISCORD_CLIENT_ID) {
  throw new Error("Missing Discord environment variables");
}

if (
  !DO_SPACES_KEY ||
  !DO_SPACES_SECRET ||
  !DO_SPACES_ENDPOINT ||
  !DO_SPACES_BUCKET
) {
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
  DUNGEON_MASTER_CALLBACK_URL,
};
