import Player from '../services/player.js';

export const parsePositionArgument = (arg: string, player: Player): number => {
  const queueLength = player.getFullQueueLength();
  const currentQueuePosition = player.queuePosition;

  let basePosition: number | undefined; // 1-based index
  let offset = 0;

  const offsetMatch = /([+-]\d+)$/.exec(arg);
  let baseArg = arg;

  if (offsetMatch) {
    offset = parseInt(offsetMatch[1], 10);
    baseArg = arg.slice(0, offsetMatch.index).trim();
  }

  if (baseArg === 'top') {
    basePosition = 1;
  } else if (baseArg === 'current') {
    basePosition = currentQueuePosition + 1;
  } else if (baseArg === 'next') {
    basePosition = currentQueuePosition + 2;
  } else if (baseArg === 'last') {
    basePosition = queueLength;
  } else {
    basePosition = parseInt(baseArg, 10);
  }

  if (isNaN(basePosition) || basePosition < 1) {
    throw new Error('Invalid position keyword or number.');
  }

  let finalPosition = basePosition + offset;

  // Ensure 'finalPosition' is within valid bounds (1 to queueLength)
  finalPosition = Math.max(1, Math.min(finalPosition, queueLength));

  return finalPosition;
};

