import { CommandInteraction, SlashCommandBuilder, TextChannel} from "discord.js";
import * as fs from 'fs';
import * as util from 'util';
import * as child_process from 'child_process';
import { promisify } from 'util';
import sqlite3 from 'sqlite3';
const readFile = promisify( fs.readFile );
import { config } from "../config";
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import {
  Document,
  VectorStoreIndex,
  Settings,
  OpenAI,
  QdrantVectorStore,
  storageContextFromDefaults
} from "llamaindex";

const exec = util.promisify(child_process.exec);

const ARCHIVES_PATH = path.join(__dirname, '..', '..', '..', 'data', 'archives');
const SRC_PATH = path.join(__dirname, '..');
console.log("ARCHIVES_PATH:" + ARCHIVES_PATH);
console.log("SRC_PATH:" + SRC_PATH);
const db = new sqlite3.Database( path.resolve(ARCHIVES_PATH, 'db.sqlite'),sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, 
  (err) => { 
    if(err) console.log("Can't open database: " + err);
  });


export const data = new SlashCommandBuilder()
  .setName("lurk")
  .setDescription("Llama will lurk in this channel");


export async function execute(interaction: CommandInteraction) {
  // Respond to the discord command immediately
  // If the logs indicate that the llama has not completed or failed it's task, let the user know that it's busy
  if(interaction["channel"] == null) return interaction.reply("Something went really wrong 😥");
  const responses = {
    "ready": "Am now lurking this channel 👀",
    "busy": "I'm busy lurking already. Check the status with `/status`",
  }
  await interaction.deferReply();
  fs.readFile('./log.txt', 'utf8', (err: any, data: string) => {
    if (err) {
      console.error('Error reading the file:', err);
      return interaction.reply("Something went really wrong 😥");
    }
    let isAvailable = "busy";
    let lines = data.split(/\r?\n/);
    // The llama should back up the channel if either the job is complete or the last job failed in any way
    if( lines[0].indexOf("🟩 Complete: Archive") != -1) isAvailable = "ready"
    if( lines[0].indexOf("🟥 Failed") != -1) isAvailable = "ready"
    if( !lines[0]) isAvailable = "ready"

    if(isAvailable == "ready") lurk(interaction.channel as TextChannel);
    return interaction.editReply(responses[isAvailable as keyof typeof responses]);

  })
}

const lurk = async function(channel: TextChannel) {
  // Archive the channel
  await appendLog(`🟩 Initiating: Archive of *${channel.name}* - ${Date.now().toString()}\n`);
  try{
    await archive(channel);
  }
  catch(e){
    await appendLog(`🟥 Failed: Archive of *${channel.name}* - ${Date.now().toString()}\n`);
    console.log(e);
  }
  try{
    await appendLog(`🟩 Initiating: Parse of *${channel.name}* - ${Date.now().toString()}\n`);
    await parse();
  }
  catch(e){
    await appendLog(`🟥 Failed: Parse of *${channel.name}* - ${Date.now().toString()}\n`);
    console.log(e);
  }
  try{
    await appendLog(`🟩 Initiating: Indexing of *${channel.name}* - ${Date.now().toString()}\n`);
    await index();
    await appendLog(`🟩 Complete: Archive and indexing of *${channel.name}* - ${Date.now().toString()}\n`);
  }
  catch(e){
    await appendLog(`🟥 Failed: Index of *${channel.name}* - ${Date.now().toString()}\n`);
    console.log(e);
  }
  return
}
/**
 * Archives a discord channel to a raw JSON file using the DiscordChatExporter CLI tool.
 * @param {TextChannel} channel - The channel to archive.
 * @param {string} [TOKEN=config.DISCORD_API_TOKEN] - The Discord API token to use for the export.
 * @param {string} [EXPORTFORMAT='json'] - The format of the export.
 * @returns {Promise<void>} - Resolves when the archive is complete.
 * @throws {Error} - If the export fails.
 */
const archive = async function(channel: TextChannel, TOKEN: string = config.DISCORD_API_TOKEN, EXPORTFORMAT: string = 'json') {
  // Call the Discord Chat Exporter CLI tool
  const now = Date.now().toString();
  const command = `/opt/app/DiscordChatExporter.Cli export -t ${TOKEN} -c ${channel.id} -f ${EXPORTFORMAT} -o ${ARCHIVES_PATH + '/raw/' + channel.id  + '-' + now}.json`;
  const { stdout } = await exec(command);
  if(stdout.indexOf("Successfully exported") != -1){
    // When the stdout indicates that the export was successful, log the event      
    await appendLog(`🟩 Complete: Archive of *${channel.name}* - ${Date.now().toString()}\n`);
    return;
  }
  else{
    throw new Error(stdout);
  }

}

/**
 * Parses the raw JSON files in the archives directory and inserts them into the database.
 * Only inserts messages that have content and have not been previously indexed.
 * Sets the indexed flag to false on the inserted messages.
 * @returns {Promise<void>} - Resolves when the parse is complete.
 * @throws {Error} - If the parse fails.
 */
const parse = async function() {      
    let total = 0
    await new Promise((resolve, reject) => {
      db.exec(fs.readFileSync(path.resolve(SRC_PATH + '/sql/Messages.sql')).toString(), (err) => {
        resolve(true)
      });
      
    })
    const rawFiles = fs.readdirSync(path.resolve(ARCHIVES_PATH + '/raw/'), {withFileTypes: true})
    .filter(item => !item.isDirectory())
    .map(item => item.name)
    const rawJSON:Array<any>= await Promise.all(rawFiles.map((file) => {
      return readFile(ARCHIVES_PATH + '/raw/' + file, 'utf8').then((data) => JSON.parse(data));
    }))
    await Promise.all(rawJSON.map(async(backup) => {
      return new Promise((resolve, reject) => {
        let channel = backup.channel.id;
        db.serialize(function() {
          let statement = db.prepare('INSERT OR REPLACE INTO Messages (id, content, author, channel, sentAt, indexed) VALUES (?,?,?,?,?,?)');
          backup.messages.filter(message => message['content'] && message.content.length > 0).map((message) => {
            
            statement.run([message['id'], message['content'], message['author']['id'], channel, message['timestamp'], false], (err) => {
              if (err) {
                console.error("Error inserting data: " + err);
              }
              else{
                total++
              }
              resolve(true)
            });
          });
          statement.finalize();
        });        
      })
    }));
    console.log(`${total} parsed messages`)
}


/**
 * Indexes messages in the database into a vector store index.
 * @returns {Promise<void>} - Resolves when the index is complete.
 * @throws {Error} - If the index fails.
 */
const index = async function() {
  let total = 0;
  let updatedIds: number[] = [];
  let documents: Document[] = []
  await new Promise((resolve, reject) => {
    db.all("SELECT * FROM Messages WHERE indexed = 0", 
      (err, rows) => {
        console.log(`Found ${rows.length} unindexed messages`)
        if (err) {
          console.error("Error reading data: " + err);
        }
        rows.map((row) => {
          updatedIds.push(row['id']);
          documents.push(new Document({
            text: row['content'],
            id_: row['id'],
            metadata: {
              messageId: row['id'],
              channelId: row['channel'],
              authorId: row['author'],
              sentAt: row['sentAt'],
            }
          }))
          total++
        })
        resolve(true);
    });    
  })

  console.log("Creating Vector Store Index")



  // Split text and create embeddings. Store them in a Qdrant vector store
  console.log(`${documents.length} documents created`)
  const qdrant = new QdrantVectorStore({
    url: config.QDRANT_URL,
    apiKey: config.QDRANT_KEY
  })
  const context = await storageContextFromDefaults({ vectorStore: qdrant });
  const store = await VectorStoreIndex.fromDocuments(documents, { storageContext: context });
  await new Promise((resolve, reject) => {
    db.serialize(function() {
      let statement = db.prepare('UPDATE Messages SET indexed = true WHERE id = (?)');
      updatedIds.map((id) => {
        statement.run(`UPDATE Messages SET indexed = true WHERE id = ${id}`)
      })
      statement.finalize();
      resolve(true);
    });    
  })

  console.log(`${total} messages indexed`)
  console.log("Querying")
  // Query the index

  // const queryEngine = store.asQueryEngine();
  // const { response, sourceNodes } = await queryEngine.query({
  //   query: "What have you done in the last 24 hours?",
  // });

  // console.log(response);
  
}

const appendLog = async function(text: string) {
  fs.readFile("./log.txt", 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading file:', err);
      return;
    }
  
    const newData = text + data;
  
    fs.writeFile("./log.txt", newData, 'utf8', (err) => {
      if (err) {
        console.error('Error writing file:', err);
        return;
      }
  
      console.log('Data prepended to file successfully.');
    });
  });
}