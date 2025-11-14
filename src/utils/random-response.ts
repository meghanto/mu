const responses = [
  'got it famsquad',
  'gettin it done, sunshine',
  'on it, bossman',
];

export function getRandomResponse(): string {
  return responses[Math.floor(Math.random() * responses.length)];
}
