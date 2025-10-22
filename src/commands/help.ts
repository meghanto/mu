import { ChatInputCommandInteraction, Message, EmbedBuilder } from "discord.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import { inject, injectable } from "inversify";
import { TYPES } from "../types.js";
import Command from "./index.js";
import Bot from "../bot.js";
import { createMockInteraction } from "../utils/mock-interaction.js";

@injectable()
export default class HelpCommand implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName("help")
    .setDescription("explains all commands in detail");

  public aliases = ["h"];

  private readonly bot: Bot;

  constructor(@inject(TYPES.Bot) bot: Bot) {
    this.bot = bot;
  }

  public async execute(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const { commands } = this.bot;

    // Sort commands alphabetically by name
    const sortedCommands = Array.from(commands.values()).sort((a, b) =>
      (a.slashCommand.name ?? "").localeCompare(b.slashCommand.name ?? ""),
    );

    // Build compact command list in description to avoid 25 field limit
    let commandsList = "";

    for (const command of sortedCommands) {
      const commandName = command.slashCommand.name;
      if (!commandName) {
        continue;
      }

      const aliases =
        command.aliases && command.aliases.length > 0
          ? ` (${command.aliases.join(", ")})`
          : "";

      commandsList += `\`/${commandName}${aliases}\` - ${command.slashCommand.description ?? "No description"}\n`;
    }

    const helpEmbed = new EmbedBuilder()
      .setTitle("🎵 Muse Bot Commands")
      .setDescription(commandsList || "No commands available")
      .setColor(0x5865f2)
      .setFooter({
        text: "Use slash commands (/) or prefix commands with your server prefix",
      });

    await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
  }

  public async executePrefix(message: Message): Promise<void> {
    const mockInteraction = createMockInteraction(message);
    await this.execute(mockInteraction);
  }
}
