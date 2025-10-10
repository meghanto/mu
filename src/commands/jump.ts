import {ChatInputCommandInteraction, Message} from 'discord.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import Command from './index.js';
import {parsePositionArgument} from '../utils/parse-position-argument.js';

@injectable()
export default class JumpCommand implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('jump')
    .setDescription('changes the current playing index of the queue')
    .addStringOption(option => option
      .setName('position')
      .setDescription('position to jump to (e.g., 1, current, next, last, +3, -1)')
      .setRequired(true));

  public aliases = ['j', 'previous', 'prev'];

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);
    const positionArg = interaction.options.getString('position')!;

    try {
      const position = parsePositionArgument(positionArg, player);

      if (position < 1 || position > player.getFullQueueLength()) {
        await interaction.reply({content: 'Position is out of bounds.', ephemeral: true});
        return;
      }

      player.jumpTo(position);

      await interaction.reply({content: `Jumped to position ${position}.`});
    } catch (error) {
      await interaction.reply({content: (error as Error).message, ephemeral: true});
      return;
    }
  }

  public async executePrefix(message: Message, args: string[]): Promise<void> {
    let positionArg = args[0];

    const commandName = message.content.slice(message.guildSettings!.prefix.length).trim().split(/ +/)[0]?.toLowerCase();

    if (commandName === 'previous' || commandName === 'prev') {
      positionArg = 'current-1';
    }

    if (!positionArg) {
      await message.channel.send('Please provide a position to jump to.');
      return;
    }

    const mockInteraction = {
      options: {
        getString: (name: string) => {
          if (name === 'position') {
            return positionArg;
          }
          return null;
        },
      },
      guild: message.guild,
      channel: message.channel,
      user: message.author,
      reply: async (options: any) => message.reply(options),
    } as unknown as ChatInputCommandInteraction;

    await this.execute(mockInteraction);
  }
}
