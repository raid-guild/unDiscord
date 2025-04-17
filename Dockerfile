FROM tyrrrz/discordchatexporter:stable

# Install required packages
RUN apk update && \
    apk upgrade && \
    apk add --update npm && \
    apk add --update nodejs && \
    apk add --update curl

# Working directory setup
WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm install

# Copy application code
COPY . .

# Expose port for the API
EXPOSE 8080

# Start the application in development mode
ENTRYPOINT ["npm", "run", "dev"]