import {Setting} from '@prisma/client';
import {prisma} from './db.js';
import {createGuildSettings} from '../events/guild-create.js';

export async function getGuildSettings(guildId: string): Promise<Setting> {
  const config = await prisma.setting.findUnique({where: {guildId}});
  if (!config) {
    return createGuildSettings(guildId);
  }

  return config;
}

export async function setGuildSettings(guildId: string, settings: Partial<Setting>): Promise<Setting> {
  return prisma.setting.update({
    where: {
      guildId,
    },
    data: settings,
  });
}
