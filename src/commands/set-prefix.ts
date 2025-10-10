import {SlashCommandBuilder} from '@discordjs/builders';
import {ChatInputCommandInteraction, Message} from 'discord.js';
import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import Command from './index.js';
import {getGuildSettings, setGuildSettings} from '../utils/get-guild-settings.js';
import errorMsg from '../utils/error-msg.js';

@injectable()
export default class SetPrefixCommand implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('set-prefix')
    .setDescription('Sets the prefix for prefix commands.')
    .addStringOption(option => option.setName('prefix').setDescription('The new prefix').setRequired(true));

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const newPrefix = interaction.options.getString('prefix');

    if (!newPrefix) {
      await interaction.reply(errorMsg('Please provide a prefix.'));
      return;
    }

    await setGuildSettings(interaction.guildId!, {prefix: newPrefix});

    await interaction.reply(`Prefix set to \`${newPrefix}\``);
  }

  public async executePrefix(message: Message, args: string[]): Promise<void> {
    const newPrefix = args[0];

    if (!newPrefix) {
      await message.channel.send(errorMsg('Please provide a prefix.'));
      return;
    }

    await setGuildSettings(message.guild.id, {prefix: newPrefix});

    await message.channel.send(`Prefix set to \`${newPrefix}\``);
  }
}