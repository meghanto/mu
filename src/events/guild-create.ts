import {Client, Guild} from 'discord.js';
import container from '../inversify.config.js';
import Command from '../commands/index.js';
import {TYPES} from '../types.js';
import Config from '../services/config.js';
import {prisma} from '../utils/db.js';
import {REST} from '@discordjs/rest';
import {Setting} from '@prisma/client';
import registerCommandsOnGuild from '../utils/register-commands-on-guild.js';

export async function createGuildSettings(guildId: string): Promise<Setting> {
  return prisma.setting.upsert({
    where: {
      guildId,
    },
    create: {
      guildId,
    },
    update: {},
  });
}

export default async (guild: Guild): Promise<void> => {
  await createGuildSettings(guild.id);

  const config = container.get<Config>(TYPES.Config);

  // Setup slash commands
  if (!config.REGISTER_COMMANDS_ON_BOT) {
    const client = container.get<Client>(TYPES.Client);

    const rest = new REST({version: '10'}).setToken(config.DISCORD_TOKEN);

    await registerCommandsOnGuild({
      rest,
      applicationId: client.user!.id,
      guildId: guild.id,
      commands: container
        .getAll<Command>(TYPES.Command)
        .map(command => command.slashCommand),
    });
  }

  const owner = await guild.fetchOwner();
  try {
    await owner.send(
      '👋 Hi! Someone (probably you) just invited me to a server you own. By default, I\'m usable by all guild member in all guild channels. To change this, check out the wiki page on permissions: https://github.com/museofficial/muse/wiki/Configuring-Bot-Permissions.',
    );
  } catch (error: unknown) {
    // Owner might have DMs disabled, don't crash the bot
    console.warn(
      `Could not send welcome message to guild owner ${owner.user.tag} (${guild.id}):`,
      error instanceof Error ? error.message : String(error),
    );
  }
};
