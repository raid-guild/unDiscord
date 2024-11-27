FROM tyrrrz/discordchatexporter:stable
RUN apk update && \
    apk upgrade && \
    apk add --update npm && \
    apk add --update nodejs 
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 8080
ENTRYPOINT ["npm", "run", "dev"]
