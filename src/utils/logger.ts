import {
  Client,
  Collection,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageContextMenuCommandInteraction,
  TextChannel,
  UserContextMenuCommandInteraction,
} from "discord.js";
import { config } from "../config.js";

type ClientWithCommands = Client & {
  commands?: Collection<string, unknown>;
};

export const discordLogger = (
  errorMessage: unknown,
  client: ClientWithCommands
) => {
  try {
    const guild = client.guilds.cache.get(config.DISCORD_GUILD_ID);

    if (!guild) {
      console.error("Error logging: guild not found");
      return;
    }

    const commandCenterChannel = guild.channels.cache.get(
      config.DISCORD_COMMAND_CENTER_ID
    );

    if (!commandCenterChannel) {
      console.error("Error logging: command center channel not found");
      return;
    }

    const embed = new EmbedBuilder()
      .setDescription(String(errorMessage))
      .setColor("#ff3864");

    (commandCenterChannel as unknown as TextChannel).send({ embeds: [embed] });
  } catch (err) {
    console.log(err);
  }
};

export const logError = async (
  client: ClientWithCommands,
  interaction:
    | ChatInputCommandInteraction
    | MessageContextMenuCommandInteraction
    | UserContextMenuCommandInteraction,
  error: unknown,
  content: string
) => {
  console.error(error);
  discordLogger(error, client);
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({
      content,
    });
  } else {
    await interaction.reply({
      content,
    });
  }
};
