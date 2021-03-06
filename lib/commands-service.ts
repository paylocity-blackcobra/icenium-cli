///<reference path=".d.ts"/>
"use strict";

export class CommandsService implements ICommandsService {
	constructor(private $errors: IErrors) { }

	public allCommands(): string[] {
		return $injector.getRegisteredCommandsNames();
	}

	public executeCommandUnchecked(commandName: string, commandArguments: string[]): boolean {
		var command = $injector.resolveCommand(commandName);
		if (command) {
			command.execute(commandArguments).wait();
			return true;
		} else {
			return false;
		}
	}

	public executeCommand(commandName: string, commandArguments: string[]): boolean {
		return this.$errors.beginCommand(
			() => this.executeCommandUnchecked(commandName, commandArguments),
			() => this.executeCommand("help", [commandName]));
	}

	public completeCommand() {
		var tabtab = require("tabtab");
		tabtab.complete("appbuilder", (err, data) => {
			if (err || !data) {
				return;
			}

			var deviceSpecific = ["build", "deploy"];
			var propertyCommands = ["prop-cat", "prop-set", "prop-add", "prop-del"];

			if (data.last.startsWith("--")) {
				return tabtab.log(Object.keys(require("./options").knownOpts), data, "--");
			} else if (deviceSpecific.contains(data.prev)) {
				return tabtab.log(["ios", "android"], data);
			} else {
				var propSchema = require("./helpers").getProjectFileSchema();
				if (propertyCommands.contains(data.prev)) {
					return tabtab.log(Object.keys(propSchema), data);
				} else if (_.some(propertyCommands, (cmd) => {
					return data.line.indexOf(" " + cmd + " ") >= 0;
				})) {
					var parseResult = /prop-[^ ]+ ([^ ]+) /.exec(data.line);
					if (parseResult) {
						var propName = parseResult[1];
						if (propName && propSchema[propName]) {
							var range = propSchema[propName].range;
							if (range) {
								if (!_.isArray(range)) {
									var helpers = require("./helpers");
									range = _.map(range, (value: { input }, key) => {
										return value.input || key;
									});
								}
								return tabtab.log(range, data);
							}
						}
					}
				}
				return tabtab.log($injector.getRegisteredCommandsNames(), data);
			}
		});

		return true;
	}
	}
$injector.register("commandsService", CommandsService);
