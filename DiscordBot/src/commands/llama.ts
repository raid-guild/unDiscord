/**
 * 1. Input a question
 * 2. Ask AkashChat
 * 3. Send response
 */

import { CommandInteraction, SlashCommandBuilder} from "discord.js";
import { config } from "../config";
import {
  VectorStoreIndex,
  Settings,
  OpenAI,
  QdrantVectorStore
} from "llamaindex";
const vectorStore = new QdrantVectorStore({
  url: config.QDRANT_URL,
  apiKey: config.QDRANT_KEY
});
export const data = new SlashCommandBuilder()
  .setName("llama")
  .setDescription("Ask llama a question")
  .addStringOption(option => 
    option.setName("question")
    .setDescription("The question to ask the llama")
    .setRequired(true)
  );

export async function execute(interaction: CommandInteraction,) {
  await interaction.deferReply();

  try{
      Settings.llm = new OpenAI({
    additionalSessionOptions: {baseURL: config.AKASH_CHAT_API_ENDPOINT},
    apiKey: config.AKASH_CHAT_API_KEY,
    model: config.AKASH_CHAT_API_MODEL,
  });
  let question = interaction.options.get("question");
  console.log("Question:" + question?.value);
  const store = await VectorStoreIndex.fromVectorStore(vectorStore);
  const queryEngine = store.asQueryEngine();

  const { message, sourceNodes } = await queryEngine.query({
    query: question?.value,
  });
  console.log("Answer:" + JSON.stringify(message));
  return interaction.editReply(message.content.toString());

  }
  catch(e){
    console.log(e);
    return interaction.editReply("Something went really wrong 😥");

  }
}


