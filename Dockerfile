# The thread merger depends on DiscordChatExporter's generated HTML structure.
# Pin the tested multi-platform image so rebuilds do not change that contract.
FROM tyrrrz/discordchatexporter:stable@sha256:26d5141062a1ac0d611ce2d8c1b5b4d9c99f4264ba38d78d310f8bb7a7015e47

# Install required packages
RUN apk update && \
    apk upgrade && \
    apk add --update npm && \
    apk add --update nodejs && \
    apk add --update curl

# Working directory setup
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install --global pnpm@10.26.0 && \
    pnpm install --frozen-lockfile

# Copy application code
COPY . .

# Expose port for the API
EXPOSE 8080

# Start the application in development mode
ENTRYPOINT ["pnpm", "run", "dev"]
