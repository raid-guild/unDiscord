/**
 * 1. Reads all the logs. 
 * 2. Reports the status of any lurking.
 */


import { CommandInteraction, SlashCommandBuilder} from "discord.js";
import * as fs from 'fs';

export const data = new SlashCommandBuilder()
  .setName("status")
  .setDescription("Reports the status of any lurking");

export async function execute(interaction: CommandInteraction) {
  // read from the log.txt file
    await interaction.deferReply();
    fs.readFile('./log.txt', 'utf8', (err, data) => {
      if (err) {
        console.error('Error reading the file:', err);
        return interaction.editReply("I wasn't able to read the file... 😥");
      }
      let lines = data.split(/\r?\n/);
      let status = '';
      for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        if(line.indexOf("-") == -1){
          status += line + '\n'; 
          continue;
        }
        //                                   day hour  min  sec  msec
        const OneDay = new Date().getTime() + (1 * 24 * 60 * 60 * 1000)
        console.log("Date: " + Date.parse(line.split("-")[1]));
        if (Date.parse(line.split("-")[1]) < OneDay) {
          status += line + '\n';
          continue;
        };
        break
      };
      if(!data) return interaction.editReply(`I've done nothing in the last 24 hours...`);
      return interaction.editReply(`Here's the status of my activities in the last 24 hours: \n${data}`);

    })
}
