import {inject, injectable} from 'inversify';
import {ChatInputCommandInteraction} from 'discord.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import Command from './index.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('clear')
    .setDescription('clears all songs in queue except currently playing song');

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public readonly aliases = ['c'];

  public async executePrefix(message: Message, args: string[], prefix: string): Promise<void> {
    // Clear command doesn't take arguments for prefix commands
    const mockInteraction: ChatInputCommandInteraction = {
      guild: message.guild,
      channel: message.channel,
      member: message.member,
      options: {
        // No options for clear command
      } as any,
      deferReply: async (options?: any) => {
        await message.channel.send('Thinking...');
      },
      editReply: async (options: any) => {
        await message.channel.send(options.content || { embeds: options.embeds });
      },
      reply: async (options: any) => {
        await message.reply(options.content || { embeds: options.embeds });
      },
    } as ChatInputCommandInteraction;

    await this.execute(mockInteraction);
  }

  public async execute(interaction: ChatInputCommandInteraction) {
    this.playerManager.get(interaction.guild!.id).clear();

    await interaction.reply('clearer than a field after a fresh harvest');
  }
}
