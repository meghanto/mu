import {ChatInputCommandInteraction, Message} from 'discord.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import Command from './index.js';
import {prettyTime} from '../utils/time.js';
import {buildPlayingMessageEmbed} from '../utils/build-embed.js';

@injectable()
export default class NowPlayingCommand implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('shows the currently playing song');

  public aliases = ['np'];

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

    if (!player.getCurrent()) {
      await interaction.reply('Nothing is currently playing.');
      return;
    }

    await interaction.reply({embeds: [buildPlayingMessageEmbed(player)]});
  }

  public async executePrefix(message: Message, args: string[]): Promise<void> {
    const player = this.playerManager.get(message.guild!.id);

    if (!player.getCurrent()) {
      await message.reply('Nothing is currently playing.');
      return;
    }

    await message.reply({embeds: [buildPlayingMessageEmbed(player)]});
  }
}