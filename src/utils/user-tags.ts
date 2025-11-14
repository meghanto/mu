import fs from 'fs/promises';
import path from 'path';
import {SongMetadata} from '../services/player.js';

const TAGS_DIR = path.join('data', 'tags');

export type UserTags = Record<string, SongMetadata[]>; // TagName -> songs

export async function readUserTags(userId: string): Promise<UserTags> {
  const filePath = path.join(TAGS_DIR, `${userId}.json`);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as UserTags;
  } catch (err) {
    const emptyTags: UserTags = {};
    return emptyTags;
  }
}

export async function writeUserTags(
  userId: string,
  tags: UserTags,
): Promise<void> {
  const filePath = path.join(TAGS_DIR, `${userId}.json`);
  await fs.mkdir(TAGS_DIR, {recursive: true});
  await fs.writeFile(filePath, JSON.stringify(tags, null, 2));
}

export function isValidTagName(tag: string): boolean {
  // Letters, numbers, dashes, underscores; 1-32 chars
  return /^[A-Za-z0-9_-]{1,32}$/.test(tag);
}

export function addSongToTag(
  tags: UserTags,
  tagName: string,
  song: SongMetadata,
): {added: boolean} {
  const lower = tagName.toLowerCase();
  const list = tags[lower] ?? [];
  if (list.some(s => s.url === song.url)) {
    return {added: false};
  }

  tags[lower] = [...list, song];
  return {added: true};
}

export function listTags(
  tags: UserTags,
): Array<{tag: string; count: number}> {
  return Object.entries(tags)
    .map(([tag, songs]) => ({tag, count: songs.length}))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}
