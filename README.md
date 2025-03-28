# Discord Channel Exporter Service

This service provides an API endpoint that exports Discord channels to HTML using DiscordChatExporter and stores them in DigitalOcean Spaces. It's designed to work with the DungeonMaster bot for RaidGuild's channel archiving workflow.

## Features

- Export Discord channels to HTML using DiscordChatExporter CLI
- Upload exported HTML files to DigitalOcean Spaces for permanent storage
- Notify a callback URL when export completes (for integration with DungeonMaster bot)
- RESTful API for triggering exports
- Secure environment variable configuration
- Docker-based deployment

## Prerequisites

- Discord Bot Token with appropriate permissions
- DigitalOcean Spaces account with access keys
- Docker and Docker Compose (for local development)
- Akash Network account (for production deployment)

## Environment Variables

Create a `.env` file in the `DiscordBot` directory with the following variables:

```
# Discord Bot Configuration
DISCORD_API_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_GUILD_ID=your_guild_id_optional

# DigitalOcean Spaces Configuration
DO_SPACES_KEY=your_spaces_key
DO_SPACES_SECRET=your_spaces_secret
DO_SPACES_ENDPOINT=https://nyc3.digitaloceanspaces.com
DO_SPACES_BUCKET=your_bucket_name

# Dungeon Master Bot Callback
DUNGEON_MASTER_CALLBACK_URL=https://your-dungeon-master-bot-endpoint.com/callback

# Optional: Basic Auth (recommended for production)
API_KEY=your_secure_random_api_key
```

## Local Development Setup

1. Clone the repository:
   ```
   git clone <repository-url>
   cd unDiscord
   ```

2. Create the `.env` file with your environment variables in the DiscordBot directory.

3. Build and start the service with Docker Compose:
   ```
   docker-compose up --build
   ```

4. The service will be available at `http://localhost:8080`.

## API Endpoints

### Health Check
```
GET /health
```
Returns a 200 OK response if the service is running.

### Export Channel
```
POST /export
Content-Type: application/json
X-API-Key: your_api_key

{
  "channelId": "your_discord_channel_id",
  "guildId": "your_discord_guild_id"
}
```

The `guildId` parameter is optional if you've set the `DISCORD_GUILD_ID` environment variable.

### Response

The export endpoint returns a 202 Accepted response immediately and processes the export asynchronously:

```json
{
  "message": "Export started",
  "channelId": "your_discord_channel_id",
  "guildId": "your_discord_guild_id"
}
```

When the export is complete, the service will call the `DUNGEON_MASTER_CALLBACK_URL` with the following payload:

```json
{
  "channelId": "your_discord_channel_id",
  "guildId": "your_discord_guild_id",
  "success": true,
  "archiveUrl": "https://your-bucket.nyc3.digitaloceanspaces.com/discord-archives/your_channel_id-timestamp.html"
}
```

If the export fails, the `success` field will be `false` and the `archiveUrl` field will be omitted.

## Deployment on Akash Network

Follow the deployment guide in [AKASH_DEPLOYMENT.md](AKASH_DEPLOYMENT.md) for detailed instructions on deploying to Akash Network.

## Troubleshooting

### Common Issues

- **Certificate Errors with DigitalOcean Spaces**: If you see TLS certificate errors, make sure you're using the correct endpoint URL and that the `forcePathStyle` option is enabled in the S3 client configuration.

- **Discord API Rate Limits**: The DiscordChatExporter CLI can hit rate limits if you're exporting large channels or many channels in a short period. Consider adding delays between exports.

- **Permission Errors**: Make sure your Discord bot has the necessary permissions to read the channels you're exporting.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.