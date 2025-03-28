# Deploying Discord Channel Exporter on Akash Network

This guide provides step-by-step instructions for deploying the Discord Channel Exporter service on the Akash Network.

## Prerequisites

1. An Akash account with AKT tokens for deployment
2. [Akash CLI](https://docs.akash.network/guides/cli) installed and configured
3. All environment variables ready (Discord tokens, DigitalOcean Spaces credentials, etc.)

## Step 1: Create the Deployment SDL File

Create a file named `discord-exporter.sdl` with the following content:

```yaml
---
version: "2.0"
services:
  discord-exporter:
    image: your-docker-hub-username/discord-exporter:latest
    expose:
      - port: 8080
        as: 80
        to:
          - global: true
    env:
      - DISCORD_API_TOKEN=${DISCORD_API_TOKEN}
      - DISCORD_CLIENT_ID=${DISCORD_CLIENT_ID}
      - DISCORD_GUILD_ID=${DISCORD_GUILD_ID}
      - DO_SPACES_KEY=${DO_SPACES_KEY}
      - DO_SPACES_SECRET=${DO_SPACES_SECRET}
      - DO_SPACES_ENDPOINT=${DO_SPACES_ENDPOINT}
      - DO_SPACES_BUCKET=${DO_SPACES_BUCKET}
      - DUNGEON_MASTER_CALLBACK_URL=${DUNGEON_MASTER_CALLBACK_URL}
      - API_KEY=${API_KEY}
    params:
      storage:
        data:
          mount: /data/archives
          readOnly: false
profiles:
  compute:
    discord-exporter:
      resources:
        cpu:
          units: 1
        memory:
          size: 1Gi
        storage:
          - size: 1Gi
          - name: data
            size: 10Gi
            attributes:
              persistent: true
              class: beta3
  placement:
    dcloud:
      attributes:
        host: akash
      signedBy:
        anyOf:
          - akash1365yvmc4s7awdyj3n2sav7xfx76adc6dnmlx63
      pricing:
        discord-exporter:
          denom: uakt
          amount: 10000
deployment:
  discord-exporter:
    dcloud:
      profile: discord-exporter
      count: 1
```

## Step 2: Build and Push Docker Image

Before deploying to Akash, you need to build your Docker image and push it to Docker Hub.

```bash
# Navigate to your project directory
cd unDiscord

# Build the Docker image
docker build -t your-docker-hub-username/discord-exporter:latest ./DiscordBot

# Log in to Docker Hub
docker login

# Push the image to Docker Hub
docker push your-docker-hub-username/discord-exporter:latest
```

Make sure to replace `your-docker-hub-username` with your actual Docker Hub username.

## Step 3: Deploy to Akash

Now you can deploy your service to Akash using the Akash Console or CLI.

### Using Akash Console (Recommended for Beginners)

1. Go to [Akash Console](https://console.akash.network)
2. Connect your wallet
3. Click on "New Deployment"
4. Upload your SDL file (`discord-exporter.sdl`)
5. Fill in all the environment variables
6. Choose a provider and complete the deployment process

### Using Akash CLI

If you prefer using the CLI, follow these steps:

```bash
# Create a deployment
akash tx deployment create discord-exporter.sdl --from your-account-name --chain-id akashnet-2 --node https://rpc.akashnet.net:443 --gas-prices 0.025uakt --gas auto --gas-adjustment 1.3 -y

# View your deployments
akash query deployment list --owner $(akash keys show your-account-name -a) --node https://rpc.akashnet.net:443

# View bids for your deployment (note the DSEQ from the previous command)
akash query market bid list --owner $(akash keys show your-account-name -a) --node https://rpc.akashnet.net:443 --dseq YOUR_DSEQ

# Create a lease with a provider of your choice (use DSEQ, GSEQ, OSEQ from previous commands)
akash tx market lease create --chain-id akashnet-2 --node https://rpc.akashnet.net:443 --dseq YOUR_DSEQ --provider PROVIDER_ADDRESS --gseq 1 --oseq 1 --from your-account-name --gas-prices 0.025uakt --gas auto --gas-adjustment 1.3 -y

# Send manifest to the provider
akash provider send-manifest discord-exporter.sdl --node https://rpc.akashnet.net:443 --dseq YOUR_DSEQ --provider PROVIDER_ADDRESS --from your-account-name --home ~/.akash

# Get your service URI
akash provider lease-status --node https://rpc.akashnet.net:443 --dseq YOUR_DSEQ --provider PROVIDER_ADDRESS --from your-account-name --home ~/.akash
```

## Step 4: Configure Environment Variables

When deploying through the Akash Console, you'll need to set the following environment variables:

- `DISCORD_API_TOKEN`: Your Discord bot token
- `DISCORD_CLIENT_ID`: Your Discord application client ID
- `DISCORD_GUILD_ID`: (Optional) Default Discord guild ID
- `DO_SPACES_KEY`: DigitalOcean Spaces access key
- `DO_SPACES_SECRET`: DigitalOcean Spaces secret key
- `DO_SPACES_ENDPOINT`: DigitalOcean Spaces endpoint (e.g., `https://nyc3.digitaloceanspaces.com`)
- `DO_SPACES_BUCKET`: DigitalOcean Spaces bucket name
- `DUNGEON_MASTER_CALLBACK_URL`: URL for the DungeonMaster bot callback
- `API_KEY`: A secure API key for your service

## Step 5: Verify Deployment

Once your deployment is complete, you can verify it's working by:

1. Accessing the health endpoint at `https://your-deployment-uri/health`
2. Testing the export endpoint with a sample request:

```bash
curl -X POST \
  https://your-deployment-uri/export \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: your_api_key' \
  -d '{
    "channelId": "your_discord_channel_id",
    "guildId": "your_discord_guild_id"
  }'
```

## Step 6: Set Up Monitoring (Optional but Recommended)

You can set up monitoring for your deployment using [UptimeRobot](https://uptimerobot.com/) or similar services to receive alerts if your service goes down.

## Step 7: Update the DungeonMaster Bot

Update the DungeonMaster bot with the URL of your deployed service. This will allow it to trigger channel exports when the `/to-valhalla` command is used.

## Troubleshooting

If your deployment fails or the service doesn't work as expected, check the logs:

```bash
akash provider lease-logs --node https://rpc.akashnet.net:443 --dseq YOUR_DSEQ --provider PROVIDER_ADDRESS --from your-account-name --home ~/.akash
```

Common issues:
- Incorrect environment variables
- Network connectivity issues
- Rate limiting from Discord API
- Insufficient resources allocated in the SDL

## Updating Your Deployment

To update your deployment (e.g., after making code changes):

1. Build and push a new Docker image with a different tag
2. Update the SDL file with the new image tag
3. Create a new deployment or update the existing one

## Closing Your Deployment

When you're done with your deployment, you can close it to stop incurring costs:

```bash
akash tx deployment close --node https://rpc.akashnet.net:443 --dseq YOUR_DSEQ --from your-account-name --chain-id akashnet-2 --gas-prices 0.025uakt --gas auto --gas-adjustment 1.3 -y
```