import Player from '../services/player.js';

export const parsePositionArgument = (arg: string, player: Player): number => {
  const queueLength = player.getFullQueueLength();
  const currentQueuePosition = player.queuePosition;

  // Prevent confusion: if arg looks like a dashed range (e.g., "5-8"), reject it
  // This ensures negative offsets (e.g., "5-2" for position 5 minus 2) are not confused with ranges
  // Dashed ranges should be handled by separate commands (like moverange)
  // Only reject if second number >= first number (e.g., "5-8"), not if it's smaller (e.g., "5-2" which is an offset)
  const dashedRangeMatch = /^(\d+)-(\d+)$/.exec(arg);
  if (dashedRangeMatch) {
    const first = parseInt(dashedRangeMatch[1], 10);
    const second = parseInt(dashedRangeMatch[2], 10);
    if (second >= first) {
      throw new Error('Dashed range syntax (e.g., "5-8") is not supported. Use offset syntax (e.g., "5-2" for position 5 minus 2) or a separate range command.');
    }
    // If second < first, it's a negative offset, so continue parsing normally
  }

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

