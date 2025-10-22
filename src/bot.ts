import {Client, Collection, User} from 'discord.js';
import {inject, injectable} from 'inversify';
import ora from 'ora';
import {TYPES} from './types.js';
import container from './inversify.config.js';
import Command from './commands/index.js';
import debug from './utils/debug.js';
import handleGuildCreate from './events/guild-create.js';
import handleVoiceStateUpdate from './events/voice-state-update.js';
import errorMsg from './utils/error-msg.js';
import {isUserInVoice} from './utils/channels.js';
import Config from './services/config.js';
import {getGuildSettings} from './utils/get-guild-settings.js';
import {generateDependencyReport} from '@discordjs/voice';
import {REST} from '@discordjs/rest';
import {Routes} from 'discord-api-types/v10';
import registerCommandsOnGuild from './utils/register-commands-on-guild.js';
import PlayerManager from './managers/player.js';
import {formatError} from './utils/format-error.js';

@injectable()
export default class {
  private readonly client: Client;
  private readonly config: Config;
  private readonly playerManager: PlayerManager;
  private readonly shouldRegisterCommandsOnBot: boolean;
  private readonly commandsByName!: Collection<string, Command>;
  private readonly commandsByButtonId!: Collection<string, Command>;

  public get commands(): Collection<string, Command> {
    return this.commandsByName;
  }

  constructor(
    @inject(TYPES.Client) client: Client,
    @inject(TYPES.Config) config: Config,
    @inject(TYPES.Managers.Player) playerManager: PlayerManager,
  ) {
    this.client = client;
    this.config = config;
    this.playerManager = playerManager;
    this.shouldRegisterCommandsOnBot = config.REGISTER_COMMANDS_ON_BOT;
    this.commandsByName = new Collection();
    this.commandsByButtonId = new Collection();
  }

  public async register(): Promise<void> {
    // Load in commands
    for (const command of container.getAll<Command>(TYPES.Command)) {
      // Make sure we can serialize to JSON without errors
      try {
        command.slashCommand.toJSON();
      } catch (error) {
        console.error(error);
        throw new Error(
          `Could not serialize /${command.slashCommand.name ?? ''} to JSON`,
        );
      }

      if (command.slashCommand.name) {
        this.commandsByName.set(command.slashCommand.name, command);
      }

      if (command.handledButtonIds) {
        for (const buttonId of command.handledButtonIds) {
          this.commandsByButtonId.set(buttonId, command);
        }
      }
    }

    // Register event handlers
    // eslint-disable-next-line complexity
    this.client.on('interactionCreate', async interaction => {
      try {
        if (interaction.isCommand()) {
          const command = this.commandsByName.get(interaction.commandName);

          if (!command || !interaction.isChatInputCommand()) {
            return;
          }

          if (!interaction.guild) {
            await interaction.reply(errorMsg('you can\'t use this bot in a DM'));
            return;
          }

          const requiresVC
            = command.requiresVC instanceof Function
              ? command.requiresVC(interaction)
              : command.requiresVC;
          if (
            requiresVC
            && interaction.member
            && !isUserInVoice(interaction.guild, interaction.member.user as User)
          ) {
            await interaction.reply({
              content: errorMsg('gotta be in a voice channel'),
              ephemeral: true,
            });
            return;
          }

          if (command.execute) {
            await command.execute(interaction);
          }
        } else if (interaction.isButton()) {
          const command = this.commandsByButtonId.get(interaction.customId);

          if (!command) {
            return;
          }

          if (command.handleButtonInteraction) {
            await command.handleButtonInteraction(interaction);
          }
        } else if (interaction.isAutocomplete()) {
          const command = this.commandsByName.get(interaction.commandName);

          if (!command) {
            return;
          }

          if (command.handleAutocompleteInteraction) {
            await command.handleAutocompleteInteraction(interaction);
          }
        }
      } catch (error: unknown) {
        debug(error);

        // This can fail if the message was deleted, and we don't want to crash the whole bot
        try {
          if (
            (interaction.isCommand() || interaction.isButton())
            && (interaction.replied || interaction.deferred)
          ) {
            await interaction.editReply(errorMsg(error as Error));
          } else if (interaction.isCommand() || interaction.isButton()) {
            await interaction.reply({
              content: errorMsg(error as Error),
              ephemeral: true,
            });
          }
        } catch (replyError: unknown) {
          // Interaction might be deleted or expired
          debug(
            `Could not send error message to user: ${replyError instanceof Error ? replyError.message : String(replyError)}`,
          );
        }
      }
    });

    this.client.on('messageCreate', async message => {
      console.log('Received message:', message.content);
      if (!message.guild || message.author.bot) {
        console.log('Message ignored: not in guild or from bot');
        return;
      }

      const settings = await getGuildSettings(message.guild.id);
      const {prefix} = settings;
      console.log('Guild prefix:', prefix);

      if (!message.content.startsWith(prefix)) {
        console.log('Message does not start with prefix');
        return;
      }

      const args = message.content.slice(prefix.length).trim().split(/ +/);
      const commandName = args.shift()?.toLowerCase();
      console.log('Parsed commandName:', commandName, 'args:', args);

      if (!commandName) {
        console.log('No command name found');
        return;
      }

      let command: Command | undefined = this.commandsByName.get(commandName);
      console.log(
        'Attempting to find command by name:',
        commandName,
        'Found:',
        Boolean(command),
      );

      if (!command) {
        // Check aliases
        console.log('Command not found by name, checking aliases...');
        for (const cmd of this.commandsByName.values()) {
          if (cmd.aliases?.includes(commandName)) {
            command = cmd;
            console.log('Command found by alias:', commandName);
            break;
          }
        }
      }

      if (!command) {
        console.log('No command found after checking aliases');
        await message
          .reply({
            content: errorMsg(
              `Command \`${commandName}\` not found. Use \`${prefix}help\` to see available commands.`,
            ),
          })
          .catch(() => {
            /* Message might be deleted */
          });
        return;
      }

      console.log('Executing command:', commandName);
      try {
        if (command.executePrefix) {
          await command.executePrefix(message, args, prefix);
        } else {
          console.log('Command does not support prefix commands:', commandName);
          await message
            .reply({
              content: errorMsg(
                'This command does not support prefix commands. Use slash commands (/) instead.',
              ),
            })
            .catch(() => {
              /* Message might be deleted */
            });
        }
      } catch (error: unknown) {
        console.error('Error executing prefix command:', error);
        const errorMessage
          = error instanceof Error ? error.message : String(error);
        await message
          .reply({
            content: errorMsg(errorMessage),
          })
          .catch(() => {
            /* Message might be deleted */
          });
      }
    });

    const spinner = ora('📡 connecting to Discord...').start();

    this.client.once('ready', async () => {
      debug(generateDependencyReport());

      // Update commands
      const rest = new REST({version: '10'}).setToken(
        this.config.DISCORD_TOKEN,
      );
      if (this.shouldRegisterCommandsOnBot) {
        spinner.text = '📡 updating commands on bot...';
        await rest.put(Routes.applicationCommands(this.client.user!.id), {
          body: this.commandsByName.map(command =>
            command.slashCommand.toJSON(),
          ),
        });
      } else {
        spinner.text = '📡 updating commands in all guilds...';

        await Promise.all([
          ...this.client.guilds.cache.map(async guild => {
            await registerCommandsOnGuild({
              rest,
              guildId: guild.id,
              applicationId: this.client.user!.id,
              commands: this.commandsByName.map(c => c.slashCommand),
            });
          }),
          // Remove commands registered on bot (if they exist)
          rest.put(Routes.applicationCommands(this.client.user!.id), {
            body: [],
          }),
        ]);
      }

      this.client.user!.setPresence({
        activities: [
          {
            name: this.config.BOT_ACTIVITY,
            type: this.config.BOT_ACTIVITY_TYPE,
            url:
              this.config.BOT_ACTIVITY_URL === ''
                ? undefined
                : this.config.BOT_ACTIVITY_URL,
          },
        ],
        status: this.config.BOT_STATUS,
      });

      spinner.succeed(
        `Ready! Invite the bot with https://discordapp.com/oauth2/authorize?client_id=${this.client.user?.id ?? ''}&scope=bot%20applications.commands&permissions=36700160`,
      );
    });

    this.client.on('error', console.error);
    this.client.on('debug', debug);

    this.client.on('guildCreate', handleGuildCreate);
    this.client.on('voiceStateUpdate', handleVoiceStateUpdate);
    await this.client.login();

    // Setup graceful shutdown handlers
    this.setupGracefulShutdown();
  }

  private setupGracefulShutdown(): void {
    const gracefulShutdown = async (signal: string) => {
      console.log(
        `\n${signal} received. Saving state and shutting down gracefully...`,
      );

      try {
        // Save state for all active players
        const players = this.playerManager.getAll();
        await Promise.all(
          players.map(async player => {
            try {
              await player.saveFullState();
              debug(`Saved state for guild ${player.guildId}`);
            } catch (error: unknown) {
              debug(
                `Failed to save state for guild ${player.guildId}: ${formatError(error)}`,
              );
            }
          }),
        );

        console.log('All player states saved. Exiting...');
        process.exit(0);
      } catch (error: unknown) {
        console.error('Error during graceful shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGINT', () => {
      void gracefulShutdown('SIGINT');
    });
    process.on('SIGTERM', () => {
      void gracefulShutdown('SIGTERM');
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error: Error) => {
      console.error('Uncaught Exception:', error);
      debug(error.stack ?? error.message);
      // Don't exit immediately - log and continue
    });

    // Handle unhandled promise rejections
    process.on(
      'unhandledRejection',
      (reason: unknown, promise: Promise<unknown>) => {
        console.error('Unhandled Promise Rejection at:', promise);
        console.error('Reason:', reason);
        if (reason instanceof Error) {
          debug(reason.stack ?? reason.message);
        }
        // Don't exit immediately - log and continue
      },
    );
  }
}
