///<reference path=".d.ts"/>

"use strict";

import Fiber = require("fibers");
import Future = require("fibers/future");
import path = require("path");
import util = require("util");

require("./extensions");
require("./bootstrap");
require("./errors");
var jaroWinklerDistance = require("../vendor/jaro-winkler_distance");
var options = require("./options");

class CommandDispatcher {
	constructor(private $fs: IFileSystem,
		private $logger: ILogger,
		private $injector: IInjector,
		private $config: IConfiguration,
		private $commandsService: ICommandsService) {}

	public dispatchCommand() {
		if (options.version) {
			this.$logger.out(this.$config.version);
			return;
		}

		var commandName = this.getCommandName();
		var commandArguments = this.getCommandArguments();

		if (options.help) {
			commandArguments.unshift(commandName);
			commandName = "help";
		}

		if (!this.$commandsService.executeCommand(commandName, commandArguments)) {
			this.$logger.fatal("Unknown command '%s'. Use 'appbuilder help' for help.", commandName);
			this.tryToMatchCommand(commandName);
		}
	}

	public completeCommand(): void {
		this.$commandsService.completeCommand();
	}

	private tryToMatchCommand(commandName): void {
		var allCommands = _.reject(this.$commandsService.allCommands(), (command) => command.startsWith("dev-"));
		var similarCommands = [];
		_.each(allCommands, (command) => {
			var distance = jaroWinklerDistance(commandName, command);
			if (commandName.length > 3 && command.indexOf(commandName) != -1) {
				similarCommands.push({ rating: 1, name: command });
			} else if (distance >= 0.65) {
				similarCommands.push({ rating: distance, name: command });
			}

		});

		similarCommands = _.sortBy(similarCommands, (command) => {
				return -command.rating;
			}).slice(0, 5);

		if (similarCommands.length > 0) {
			var message = ["Did you mean?"];
			_.each(similarCommands, (command) => {
				message.push("\t" + command.name)
				});
			this.$logger.fatal(message.join("\n"));
		}
	}

	private getCommandName(): string {
		var remaining = options.argv.remain;
		if (remaining.length > 0) {
			return remaining[0].toLowerCase();
		}
		return "help";
	}

	private getCommandArguments(): string[] {
		var remaining = options.argv.remain;
		if (remaining.length > 1) {
			return remaining.slice(1);
		}
		return [];
	}
}

var fiber = Fiber(() => {
	var commandDispatcher = $injector.resolve(CommandDispatcher);
	if (process.argv[2] === "completion") {
		commandDispatcher.completeCommand();
	} else {
		commandDispatcher.dispatchCommand();
	}
	Future.assertNoFutureLeftBehind();
});
global.__main_fiber__ = fiber; // leak fiber to prevent it from being GC'd and thus corrupting V8
fiber.run();
