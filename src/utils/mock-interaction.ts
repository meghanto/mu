import {
  ChatInputCommandInteraction,
  InteractionReplyOptions,
  Message,
  MessagePayload,
} from "discord.js";

type OptionOverrides = Partial<{
  getString: (name: string, required?: boolean) => string | null;
  getInteger: (name: string, required?: boolean) => number | null;
  getBoolean: (name: string, required?: boolean) => boolean | null;
  getNumber: (name: string, required?: boolean) => number | null;
  getSubcommand: () => string | null;
  getAttachment: (name: string) => any | null;
}>;

interface MockInteractionOverrides {
  options?: OptionOverrides;
  reply?: Partial<{
    deferReply: () => Promise<void>;
    editReply: (payload: string | MessagePayload | InteractionReplyOptions) => Promise<Message>;
    fetchReply: () => Promise<Message>;
  }>;
}

/**
 * Creates a mock ChatInputCommandInteraction for prefix commands so we can reuse
 * slash command handlers. Replies simply send standard Discord messages.
 */
export function createMockInteraction(
  message: Message,
  overrides?: MockInteractionOverrides,
): ChatInputCommandInteraction {
  const defaultOptions = {
    getString: (_name: string, _required?: boolean) => null,
    getInteger: (_name: string, _required?: boolean) => null,
    getBoolean: (_name: string, _required?: boolean) => null,
    getNumber: (_name: string, _required?: boolean) => null,
    getSubcommand: () => null,
  };

  const options = {
    ...defaultOptions,
    ...(overrides?.options ?? {}),
  };

  let lastReply: Message | null = null;

  const sendReply = async (
    target: "reply" | "channel" | "followUp",
    payload: string | MessagePayload | InteractionReplyOptions,
  ) => {
    console.log('payload', payload);
    let response: Message;

    if (typeof payload === "string") {
      response =
        target === "reply"
          ? await message.reply(payload)
          : await message.channel.send(payload);
    } else {
      response =
        target === "reply"
          ? await message.reply(payload as any)
          : await message.channel.send(payload as any);
    }

    console.log('response', response);

    if (target === "reply") {
      lastReply = response;
    }

    return response;
  };

  const mock = {
    guild: message.guild,
    channel: message.channel,
    member: message.member,
    user: message.author,
    guildId: message.guild!.id,
    channelId: message.channel.id,
    applicationId: message.client.application!.id,
    replied: false,
    deferred: false,
    options,
    isCommand: () => true,
    reply: async (
      payload: string | MessagePayload | InteractionReplyOptions,
    ) => {
      mock.replied = true;
      return sendReply("reply", payload);
    },
    editReply: overrides?.reply?.editReply ?? (async (payload: string | MessagePayload | InteractionReplyOptions) => sendReply("reply", payload)),
    deferReply: overrides?.reply?.deferReply ?? (async () => {
      mock.deferred = true;
      await message.channel.sendTyping();
      return undefined;
    }),
    fetchReply: overrides?.reply?.fetchReply ?? (async () => lastReply ?? message as Message),
    followUp: async (
      payload: string | MessagePayload | InteractionReplyOptions,
    ) => sendReply("channel", payload),
  } as unknown as ChatInputCommandInteraction;

  return mock;
}
