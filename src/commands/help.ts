import {ChatInputCommandInteraction, Message, EmbedBuilder} from 'discord.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import Command from './index.js';
import Bot from '../bot.js';

@injectable()
export default class HelpCommand implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('help')
    .setDescription('explains all commands in detail');

  public aliases = ['h'];

  private readonly bot: Bot;

  constructor(@inject(TYPES.Bot) bot: Bot) {
    this.bot = bot;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const commands = this.bot.commands;

    const helpEmbed = new EmbedBuilder()
      .setTitle('Muse Bot Commands')
      .setDescription('Here is a list of all available commands:')
      .setColor('Blue');

    for (const command of commands) {
      let commandInfo = `**Description:** ${command.slashCommand.description}\n`;

      if (command.aliases && command.aliases.length > 0) {
        commandInfo += `**Aliases:** 
${command.aliases.join(', ')}
`;
      }

      if (command.slashCommand.options && command.slashCommand.options.length > 0) {
        commandInfo += '**Options:**\n';
        for (const option of command.slashCommand.options) {
          // This part needs to be more robust to handle different option types
          // For simplicity, just showing name and description for now
          commandInfo += `  
${option.name}
: ${option.description}
`;
        }
      }

      helpEmbed.addFields({name: `/${command.slashCommand.name}`, value: commandInfo, inline: false});
    }

    await interaction.reply({embeds: [helpEmbed], ephemeral: true});
  }

  public async executePrefix(message: Message, args: string[]): Promise<void> {
    const mockInteraction = {
      options: {
        getString: () => null,
        getInteger: () => null,
        getBoolean: () => null,
        getSubcommand: () => null,
      },
      guild: message.guild,
      channel: message.channel,
      user: message.author,
      reply: async (options: any) => message.reply(options),
    } as unknown as ChatInputCommandInteraction;

    await this.execute(mockInteraction);
  }
}
