///<reference path=".d.ts"/>

"use strict";

import xml2js = require("xml2js");
import path = require("path");
import unzip = require("unzip");
import _ = require("underscore");
var options:any = require("./options");
import util = require("util");
import helpers = require("./helpers");
import querystring = require("querystring");
import Future = require("fibers/future");
import IOSDeploymentValidator = require("./validators/ios-deployment-validator");
import projectNameValidator = require("./validators/project-name-validator");
import MobileHelper = require("./mobile/mobile-helper");

export class BuildService implements Project.IBuildService {
	constructor(private $config: IConfiguration,
		private $logger: ILogger,
		private $server: Server.IServer,
		private $projectNameValidator) { }

	public getLiveSyncUrl(urlKind: string, filesystemPath: string, liveSyncToken: string): IFuture<string> {
		return ((): string => {
			urlKind = urlKind.toLowerCase();
			if (urlKind !== "manifest" && urlKind !== "package") {
				throw new Error("urlKind must be either 'manifest' or 'package'");
			}

			// escape URLs twice to work around a bug in bit.ly
			var fullDownloadPath = util.format("%s://%s/Mist/MobilePackage/%s?packagePath=%s&token=%s",
				this.$config.AB_SERVER_PROTO,
				this.$config.AB_SERVER, urlKind,
				querystring.escape(querystring.escape(filesystemPath)),
				querystring.escape(querystring.escape(liveSyncToken)));
			this.$logger.debug("Minifying LiveSync URL '%s'", fullDownloadPath);

			var url = this.$server.cordova.getLiveSyncUrl(fullDownloadPath).wait();
			if (urlKind === "manifest") {
				url = "itms-services://?action=download-manifest&amp;url=" + querystring.escape(url);
			}

			this.$logger.debug("Device install URL '%s'", url);

			return url;
		}).future<string>()();
	}

	public buildProject(solutionName, projectName, solutionSpace, buildProperties): IFuture<Server.IBuildResult> {
		return ((): Server.IBuildResult => {
			this.$logger.info("Building project %s/%s (%s)", solutionName, projectName, solutionSpace);

			this.$projectNameValidator.validate(projectName);

			this.$server.projects.setProjectProperty(solutionName, projectName, { AppIdentifier: buildProperties.AppIdentifier }).wait();

			var liveSyncToken = this.$server.cordova.getLiveSyncToken(solutionName, projectName).wait();

			buildProperties.LiveSyncToken = liveSyncToken;

			var body = this.$server.build.buildProject(solutionName, projectName, {Properties: buildProperties}).wait();

			if (body.Errors.length) {
				this.$logger.error("Build errors: %s", body.Errors);
			}

			var buildResults: Server.IPackageDef[] = body.ResultsByTarget.Build.Items.map(function(buildResult) {
				var fullPath = buildResult.FullPath.replace(/\\/g, "/");
				var solutionPath = util.format("%s/%s", projectName, fullPath);

				return {
					platform: buildResult.Platform,
					solution: solutionName,
					solutionPath: solutionPath,
					relativePath: buildResult.FullPath
				};
			});

			return {
				buildResults: buildResults,
				output: body.Output
			};
		}).future<Server.IBuildResult>()();
	}
}
$injector.register("buildService", BuildService);

export class Project implements Project.IProject {
	private cachedProjectDir: string = "";
	public projectData: IProjectData;

	constructor(private $fs: IFileSystem,
		private $injector: IInjector,
		private $config: IConfiguration,
		private $logger: ILogger,
		private $server: Server.IServer,
		private $identityManager: Server.IIdentityManager,
		private $buildService: Project.IBuildService,
		private $projectNameValidator,
		private $errors: IErrors,
		private $opener: IOpener,
		private $loginManager: ILoginManager) {
		this.readProjectData().wait();
	}

	public getProjectDir(): string {
		if (this.cachedProjectDir !== "") {
			return this.cachedProjectDir;
		}
		this.cachedProjectDir = null;

		var projectDir = path.resolve(options.path || ".");
		while (true) {
			this.$logger.trace("Looking for project in '%s'", projectDir);

			if (this.$fs.exists(path.join(projectDir, this.$config.PROJECT_FILE_NAME)).wait()) {
				this.$logger.debug("Project directory is '%s'.", projectDir);
				this.cachedProjectDir = projectDir;
				break;
			}

			var dir = path.dirname(projectDir);
			if (dir === projectDir) {
				this.$logger.debug("No project found at or above '%s'.", path.resolve("."));
				break;
			}
			projectDir = dir;
		}

		return this.cachedProjectDir;
	}

	private getTempDir(): string {
		var dir = path.join(this.getProjectDir(), ".ab");
		this.$fs.createDirectory(dir).wait();
		return dir;
	}

	private getProjectRelativePath(fullPath): string {
		var projectDir = this.getProjectDir() + path.sep;
		if (!fullPath.startsWith(projectDir)) {
			throw new Error("File is not part of the project.");
		}

		return fullPath.substring(projectDir.length);
	}

	public enumerateProjectFiles(excludedProjectDirsAndFiles?: string[]): string[] {
		if (!excludedProjectDirsAndFiles) {
			excludedProjectDirsAndFiles = [".ab", ".abproject"];
		}

		var projectDir = this.getProjectDir();
		var projectFiles = helpers.enumerateFilesInDirectorySync(projectDir, function(filePath) {
			return !excludedProjectDirsAndFiles.contains(path.basename(filePath).toLowerCase());
		});

		this.$logger.trace("enumerateProjectFiles: %s", util.inspect(projectFiles));
		return projectFiles;
	}

	private zipProject(): IFuture<string> {
		return (() => {
			var tempDir = this.getTempDir();

			var projectZipFile = path.join(tempDir, "Build.zip");
			this.$fs.deleteFile(projectZipFile).wait();

			var files = this.enumerateProjectFiles();
			var zipOp = this.$fs.zipFiles(projectZipFile, files,
				(path) => this.getProjectRelativePath(path));

			var result = new Future<string>();
			zipOp.resolveSuccess(() => result.return(projectZipFile));
			return result.wait();
		}).future<string>()();
	}

	private requestCloudBuild(platform, configuration): IFuture<Project.IBuildResult> {
		return ((): Project.IBuildResult => {
			if (MobileHelper.isAndroidPlatform(platform)) {
				platform = "Android";
			} else if (MobileHelper.isiOSPlatform(platform)) {
				platform = "iOS";
			}

			var buildProperties:any = {
				Configuration: configuration,
				Platform: platform,

				CorePlugins: this.projectData.CorePlugins,
				AppIdentifier: this.projectData.AppIdentifier,
				ProjectName: this.projectData.name,
				ProjectGuid: this.projectData.ProjectGuid,
				FrameworkVersion: this.projectData.FrameworkVersion,
				BundleVersion: this.projectData.BundleVersion,
				DeviceOrientations: this.projectData.DeviceOrientations
			};

			if (platform === "Android") {
				buildProperties.AndroidPermissions = this.projectData.AndroidPermissions;
				buildProperties.AndroidVersionCode = this.projectData.AndroidVersionCode;
				buildProperties.AndroidHardwareAcceleration = this.projectData.AndroidHardwareAcceleration;
				buildProperties.AndroidCodesigningIdentity = ""; //TODO: where do you get this from?

				var result = this.beginBuild(buildProperties).wait();
				return result;
			} else if (platform === "iOS" ) {
				buildProperties.iOSDisplayName = this.projectData.DisplayName;
				buildProperties.iOSDeviceFamily = this.projectData.iOSDeviceFamily;
				buildProperties.iOSStatusBarStyle = this.projectData.iOSStatusBarStyle;
				buildProperties.iOSBackgroundMode = this.projectData.iOSBackgroundMode;

				var certificateData = this.$identityManager.findCertificate(options.certificate).wait();

				this.$logger.info("Using certificate '%s'", certificateData.Alias);

				var provisionData = this.$identityManager.findProvision(options.provision).wait();

				this.$logger.info("Using mobile provision '%s'", provisionData.Name);

				buildProperties.MobileProvisionIdentifier = provisionData.Identifier;
				buildProperties.iOSCodesigningIdentity = certificateData.Alias;

				var buildResult = this.beginBuild(buildProperties).wait();
				buildResult.provisionType = provisionData.ProvisionType;
				return buildResult;
			} else {
				this.$logger.fatal("Unknown platform '%s'. Must be either 'Android' or 'iOS'", platform);
				return null;
			}
		}).future<Project.IBuildResult>()();
	}

	private beginBuild(buildProperties: any): IFuture<Project.IBuildResult> {
		return ((): Project.IBuildResult => {
			Object.keys(buildProperties).forEach((prop) => {
				if (buildProperties[prop] === undefined) {
					throw new Error(util.format("Build property '%s' is undefined.", prop));
				}

				if (_.isArray(buildProperties[prop])) {
					buildProperties[prop] = buildProperties[prop].join(";");
				}
			});

			var result = this.$buildService.buildProject(this.projectData.name, this.projectData.name, this.$config.SOLUTION_SPACE_NAME, buildProperties).wait();

			if (result.output) {
				var buildLogFilePath = path.join(this.getTempDir(), "build.log");
				this.$fs.writeFile(buildLogFilePath, result.output).wait();
				this.$logger.info("Build log written to '%s'", buildLogFilePath);
			}

			this.$logger.debug(result.buildResults);

			return {
				buildProperties: buildProperties,
				packageDefs: result.buildResults,
			};
		}).future<Project.IBuildResult>()();
	}

	private showPackageQRCodes(packageDefs): IFuture<void> {
		return (() => {
			if (!packageDefs.length) {
				return;
			}

			var templateFiles = helpers.enumerateFilesInDirectorySync(path.join(__dirname, "../resources/qr"));
			var targetFiles = _.map(templateFiles, (file) => path.join(this.getTempDir(), path.basename(file)));

			var copyOps = _(_.zip(templateFiles, targetFiles)).map((zipped) => {
				var srcFile = zipped[0];
				var targetFile = zipped[1];
				this.$logger.debug("Copying '%s' to '%s'", srcFile, targetFile);
				return this.$fs.copyFile(srcFile, targetFile);
			});
			Future.wait(copyOps);

			var scanFile = _.find(targetFiles, (file) => path.basename(file) === "scan.html");
			var htmlTemplateContents = this.$fs.readText(scanFile).wait();
			htmlTemplateContents = htmlTemplateContents.replace(/\$ApplicationName\$/g, this.projectData.name)
				.replace(/\$Packages\$/g, JSON.stringify(packageDefs));
			this.$fs.writeFile(scanFile, htmlTemplateContents).wait();

			this.$logger.debug("Updated scan.html");
			this.$opener.open(scanFile);
		}).future<void>()();
	}

	public build(platform: string, configuration: string, showQrCodes: boolean, downloadFiles: boolean): IFuture<Server.IPackageDef[]> {
		return ((): Server.IPackageDef[] => {
			configuration = configuration || "Debug";
			this.$logger.info("Building project for platform '%s', configuration '%s'", platform, configuration);

			this.importProject().wait();

			var buildResult = this.requestCloudBuild(platform, configuration).wait();
			var packageDefs = buildResult.packageDefs;

			if (showQrCodes && packageDefs.length) {
				var urlKind = buildResult.provisionType === "AdHoc" ? "manifest" : "package";
				packageDefs.forEach((def:any) => {
					var liveSyncUrl = this.$buildService.getLiveSyncUrl(urlKind, def.relativePath, buildResult.buildProperties.LiveSyncToken).wait();
					def.qrUrl = helpers.createQrUrl(liveSyncUrl);

					this.$logger.debug("QR URL is '%s'", def.qrUrl);
				});

				this.showPackageQRCodes(packageDefs).wait();
			}

			if (downloadFiles) {
				packageDefs.forEach((pkg: Server.IPackageDef) => {
					var targetFileName = path.join(this.getTempDir(), path.basename(pkg.solutionPath));
					this.$logger.info("Downloading file '%s/%s' into '%s'", pkg.solution, pkg.solutionPath, targetFileName);
					var targetFile = this.$fs.createWriteStream(targetFileName);
					this.$server.filesystem.getContent(pkg.solution, pkg.solutionPath, targetFile).wait();
					this.$logger.info("Download completed: %s", targetFileName);
					pkg.localFile = targetFileName;
				});
			}

			return packageDefs;
		}).future<Server.IPackageDef[]>()();
	}

	private getBuildConfiguration(): string {
		return options["no-livesync"] ? "Release" : "Debug";
	}

	public deploy(platform: string): IFuture<Server.IPackageDef[]> {
		return (() => {
			this.validatePlatform(platform);
			var result = this.build(platform, this.getBuildConfiguration(), false, true).wait();
			return result;
		}).future<Server.IPackageDef[]>()();
	}

	public executeBuild(platform: string): IFuture<void> {
		return (() => {
			this.validatePlatform(platform);

			this.ensureProject();

			if (options.download && options.companion) {
				this.$errors.fail("Cannot specify both --download and --companion options.");
			}

			this.$loginManager.ensureLoggedIn().wait();

			if (options.companion) {
				this.deployToIon(platform).wait();
			} else {
				this.build(platform, this.getBuildConfiguration(), true, options.download).wait();
			}
		}).future<void>()();
	}

	private validatePlatform(platform: string): void {
		if (!platform || (!MobileHelper.isiOSPlatform(platform) && !MobileHelper.isAndroidPlatform(platform))) {
			this.$errors.fail("Incorrect platform '%s' specified.", platform);
		}
	}

	private deployToIon(platform: string): IFuture<void> {
		return (() => {
			if (platform.toLowerCase() !== "ios") {
				this.$errors.fail("The companion app is supported only on iOS.");
			}

			this.$logger.info("Deploying to AppBuilder companion app.");

			this.importProject().wait();

			var liveSyncToken = this.$server.cordova.getLiveSyncToken(this.projectData.name, this.projectData.name).wait();

			var hostPart = util.format("%s://%s", this.$config.AB_SERVER_PROTO, this.$config.AB_SERVER);
			var fullDownloadPath = util.format("icenium://%s?LiveSyncToken=%s", querystring.escape(hostPart), querystring.escape(liveSyncToken));

			this.$logger.debug("Using LiveSync URL for Ion: %s", fullDownloadPath);

			this.showPackageQRCodes([{
				platform: "AppBuilder companion app",
				qrUrl: helpers.createQrUrl(fullDownloadPath)
			}]).wait();
		}).future<void>()();
	}

	public importProject(): IFuture<void> {
		return (() => {
			var projectDir = this.getProjectDir();
			if (!projectDir) {
				this.$logger.fatal("Found nothing to import.");
				return;
			}

			this.$loginManager.ensureLoggedIn().wait();

			var projectZipFile = this.zipProject().wait();
			this.$logger.debug("zipping completed, result file size: %d", this.$fs.getFileSize(projectZipFile).wait());

			this.$server.projects.importProject(this.projectData.name, this.projectData.name, this.$fs.createReadStream(projectZipFile)).wait();
			this.$logger.trace("Project imported");
		}).future<void>()();
	}

	public saveProject(): IFuture<void> {
		return this.$fs.writeJson(path.join(this.getProjectDir(), this.$config.PROJECT_FILE_NAME), this.projectData, "\t");
	}

	private readProjectData(): IFuture<void> {
		return (() => {
			var projectDir = this.getProjectDir();
			if (projectDir) {
				this.projectData = this.$fs.readJson(path.join(projectDir, this.$config.PROJECT_FILE_NAME)).wait();

				var blob: any = this.projectData;
				if (blob.hasOwnProperty("iOSDisplayName")) {
					blob.DisplayName = blob.iOSDisplayName;
					delete blob.iOSDisplayName;
				}
			}
		}).future<void>()();
	}

	public createNewProject(projectName: string): IFuture<void> {
		return ((): void => {
			var projectDir = this.getNewProjectDir();

			if (!projectName) {
				projectName = this.createProjectName(projectDir).wait();
			}
			this.createFromTemplate(projectName, projectDir).wait();
		}).future<void>()();
	}

	private createProjectName(projectDir): IFuture<string> {
		return ((): string => {
			var files = this.$fs.readDirectory(projectDir).wait();
			var defaultProjectName = this.$config.DEFAULT_PROJECT_NAME;

			files = _.map(files, (f) => path.basename(f));

			if (!_.contains(files, defaultProjectName)) {
				return defaultProjectName;
			}

			for (var i = 0; ; ++i) {
				var nameWithIndex = util.format("%s%s", defaultProjectName, i);
				if (!_.contains(files, nameWithIndex)) {
					return nameWithIndex;
				}
			}
		}).future<string>()();
	}

	private createFromTemplate(appname, projectDir): IFuture<void> {
		return (() => {
			var templatesDir = path.join(__dirname, "../resources/templates"),
			template = options.template || this.$config.DEFAULT_PROJECT_TEMPLATE,
				templateFileName;

			if (!appname) {
				this.$logger.fatal("At least appname must be specified!");
				return;
			}
			projectDir = path.join(projectDir, appname);

			this.$projectNameValidator.validate(appname);
			templateFileName = path.join(templatesDir, "Telerik.Mobile.Cordova." + template + ".zip");
			this.$logger.trace("Using template '%s'", templateFileName);
			if (this.$fs.exists(templateFileName).wait()) {
				this.$logger.trace("Creating template folder '%s'", projectDir);
				this.createTemplateFolder(projectDir).wait();
				this.$logger.trace("Extracting template from '%s'", templateFileName);
				this.extractTemplate(templateFileName, projectDir).wait();
				this.$logger.trace("Reading template project properties.");
				var properties = this.getProjectProperties(projectDir, appname).wait();
				this.$logger.trace(properties);
				this.$logger.trace("Creating project file.");
				this.createProjectFile(projectDir, appname, properties).wait();
				this.$logger.trace("Removing unnecessary files from template.");
				this.removeExtraFiles(projectDir).wait();

				this.$logger.info(util.format("%s has been successfully created.", appname));
			} else {
				var message =
					["The requested template " + options.template + " does not exist.",
					"Available templates are:"];
				this.$config.TEMPLATE_NAMES.forEach((item) => {
					message.push("  " + item);
				});
				this.$errors.fail({formatStr: message.join("\n"), suppressCommandHelp: true});
			}
		}).future<void>()();
	}

	private removeExtraFiles(projectDir): IFuture<any> {
		return ((): any => {
			Future.wait(_.map(["mobile.proj", "mobile.vstemplate"],
				(file) => this.$fs.deleteFile(path.join(projectDir, file))));
		}).future<any>()();
	}

	private getProjectProperties(projectDir, appName): IFuture<any> {
		return ((): any => {
			var properties: any = {};

			if (!options.appid) {
				options.appid = this.generateDefaultAppId(appName);
				this.$logger.warn("--appid was not specified. Defaulting to " + options.appid);
			}

			var parser = new xml2js.Parser();
			var contents = this.$fs.readText(path.join(projectDir, "mobile.proj")).wait();

			var parseString = Future.wrap(function (str, callback) {
				return parser.parseString(str, callback);
			});

			var result: any = parseString(contents).wait();
			var propertyGroup: any = result.Project.PropertyGroup[0];

			properties.AppName = appName;
			properties.AppIdentifier = "";
			properties.ProjectGuid = this.generateProjectGuid();
			properties.BundleVersion = propertyGroup.BundleVersion[0];
			properties.CorePlugins = propertyGroup.CorePlugins[0];
			properties.DeviceOrientations = propertyGroup.DeviceOrientations[0];
			properties.FrameworkVersion = propertyGroup.FrameworkVersion[0];
			properties.iOSStatusBarStyle = propertyGroup.iOSStatusBarStyle[0];
			properties.AndroidPermissions = propertyGroup.AndroidPermissions[0];

			this.updateProjectProperty(properties, "set", "AppIdentifier", [options.appid]);

			return properties;
		}).future<any>()();
	}

	private getNewProjectDir() {
		return options.path || process.cwd();
	}

	public createProjectFile(projectDir: string, projectName: string, properties: any): IFuture<void> {
		return ((): void => {
			properties = properties || {};

			this.$fs.createDirectory(projectDir).wait();
			this.cachedProjectDir = projectDir;
			this.projectData = this.$fs.readJson(path.join(__dirname, "../resources/default-project.json")).wait();

			var projectSchema = helpers.getProjectFileSchema();
			Object.keys(properties).forEach(prop => {
				if (projectSchema.hasOwnProperty(prop)) {
					if(projectSchema[prop].flags) {
						this.projectData[prop] = properties[prop].split(";");
					} else {
						this.projectData[prop] = properties[prop];
					}
				}
			});

			this.projectData.name = projectName;
			if (!this.projectData.DisplayName) {
				this.projectData.DisplayName = projectName;
			}

			if (!this.projectData.ProjectGuid) {
				this.projectData.ProjectGuid = this.generateProjectGuid();
			}

			this.saveProject().wait();
		}).future<void>()();
	}

	public createTemplateFolder(projectDir: string): IFuture<any> {
		return ((): any => {
			this.$fs.createDirectory(projectDir).wait();
			var projectDirFiles = this.$fs.readDirectory(projectDir).wait();
			if (projectDirFiles.length != 0) {
				throw new Error("The specified directory must be empty to create a new project.");
			}
		}).future<any>()();
	}

	private extractTemplate(templateFileName, projectDir: string): IFuture<any> {
		return this.$fs.futureFromEvent(
			this.$fs.createReadStream(templateFileName)
			.pipe(unzip.Extract({ path: projectDir })), "close");
	}

	private generateDefaultAppId(appName: string): string {
		var sanitizedName = _.filter(appName.split(""), (c) => /[a-zA-Z0-9]/.test(c)).join("");
		if (sanitizedName) {
			return "com.telerik." + sanitizedName;
		} else {
			return "com.telerik.myapp";
		}
	}

	private generateProjectGuid() {
		return require("node-uuid").v4();
	}

	public isProjectFileExcluded(projectDir: string, filePath: string, excludedDirsAndFiles: string[]): boolean {
		var relativeToProjectPath = filePath.substr(projectDir.length + 1);
		var lowerCasePath = relativeToProjectPath.toLowerCase();
		if(excludedDirsAndFiles) {
			var excluded = false;
			excludedDirsAndFiles.forEach((file) => {
				if (lowerCasePath.startsWith(file)) {
					excluded = true;
				}
			});
			return excluded;
		}
		return false;
	}

	private normalizePropertyName(property) {
		if (!property) {
			return property;
		}

		var propSchema = helpers.getProjectFileSchema();
		var propLookup = helpers.toHash(propSchema,
			function(value, key) { return key.toLowerCase(); },
			function(value, key) { return key; });
		return propLookup[property.toLowerCase()] || property;
	}

	public updateProjectProperty(projectData:any, mode:string, property:string, newValue:any) {
		property = this.normalizePropertyName(property);
		var propSchema = helpers.getProjectFileSchema();
		var propData = propSchema[property];

		var validate = (condition: boolean, ...args) => {
			if(condition) {
				if(propData.validationMessage) {
					this.$errors.fail(propData.validationMessage);
				} else {
					this.$errors.fail.apply(null, _.rest(args, 0));
				}
			}
		};

		if (!propData) {
				this.$logger.fatal("Unrecognized property '%s'", property);
				this.printProjectSchemaHelp();
			return;
		}

		if (!propData.flags) {
			if (newValue.length !== 1) {
				this.$errors.fail("Property '%s' is not a collection of flags. Specify only a single property value.", property);
			}
			if (mode === "add" || mode === "del") {
				this.$errors.fail("Property '%s' is not a collection of flags. Use prop-set to set a property value.", property);
			}
		} else {
			newValue = _.flatten(_.map(newValue, function(value:string) { return value.split(";"); }));
		}

		var range = propData.range;
		if (range) {
			newValue = _.map(newValue, function(value:string) { return value.toLowerCase(); });

			var validValues;
			if (_.isArray(range)) {
				validValues = helpers.toHash(range,
					function(value) { return value.toLowerCase(); },
					_.identity);
			} else {
				validValues = helpers.toHash(range,
					function(value, key) { return (value.input || key).toLowerCase(); },
					function(value, key) { return key; });
			}

			var badValues = _.reject(newValue, function(value) {
				return validValues[value];
			});

			validate(badValues.length > 0, "Invalid property value%s: %s", badValues.length > 1 ? "s" : "", badValues.join("; "));

			newValue = _.map(newValue, function(value) { return validValues[value]; });
		}

		if (!propData.flags) {
			newValue = newValue[0];

			if (propData.regex) {
				var matchRegex = new RegExp(propData.regex);
				validate(!matchRegex.test(newValue), "Value '%s' is not in the format expected by property %s. Expected to match /%s/", newValue, property, propData.regex);
			}

			if (propData.validator) {
				var validator = this.$injector.resolve(propData.validator);
				validator.validate(newValue);
			}
		}

		var propertyValue = projectData[property];
		if (propData.flags && _.isString(propertyValue)) {
			propertyValue = propertyValue.split(";");
		}

		if (mode === "set") {
			propertyValue = newValue;
		} else if (mode === "del") {
			propertyValue = _.difference(propertyValue, newValue);
		} else if (mode === "add") {
			propertyValue = _.union(propertyValue, newValue);
		} else {
			this.$errors.fail("Unknown property update mode '%s'", mode);
		}

		if (propertyValue.sort) {
			propertyValue.sort();
		}

		projectData[property] = propertyValue;
	}

	public updateProjectPropertyAndSave(mode: string, propertyName: string, propertyValues: string[]): IFuture<void> {
		return (() => {
			this.ensureProject();

			this.updateProjectProperty(this.projectData, mode, propertyName, propertyValues);
			this.printProjectProperty(propertyName).wait();
			this.saveProject().wait();
		}).future<void>()();
	}

	public printProjectProperty(property: string): IFuture<void> {
		return (() => {
			this.ensureProject();
			property = this.normalizePropertyName(property);

			if (this.projectData[property]) {
				this.$logger.out(this.projectData[property]);
			} else {
				this.$logger.fatal("Unrecognized property '%s'", property);
				this.printProjectSchemaHelp();
			}
		}).future<void>()();
	}

	private printProjectSchemaHelp() {
		var schema = helpers.getProjectFileSchema();
		this.$logger.info("Project properties:");
		_.each(schema, (value:any, key) => {
			this.$logger.info(util.format("  %s - %s", key, value.description));
			if (value.range) {
				this.$logger.info("    Valid values:");
				_.each(value.range, (rangeDesc:any, rangeKey) => {
					var desc = "      " + (_.isArray(value.range) ? rangeDesc : rangeDesc.input || rangeKey);
					if (rangeDesc.description) {
						desc += " - " + rangeDesc.description;
					}
					this.$logger.info(desc);
				});
			}
			if (value.regex) {
				this.$logger.info("    Valid values match /" + value.regex.toString() + "/");
			}
		});
	}

	public ensureProject() {
		if (!this.projectData) {
			this.$errors.fail("No project found at or above '%s' and neither was a --path specified.", process.cwd());
		}
	}
}
$injector.register("project", Project);

helpers.registerCommand("project", "build", (project, args) => project.executeBuild(args[0]));
helpers.registerCommand("project", "update", (project, args) => project.importProject());
helpers.registerCommand("project", "create", (project, args) => project.createNewProject(args[0]));
_.each(["add", "set", "del"], (operation) => {
	helpers.registerCommand("project", "prop-" + operation,
		(project, args) => project.updateProjectPropertyAndSave(operation, args[0], _.rest(args, 1)));
});
helpers.registerCommand("project", "prop-print", (project, args) => project.printProjectProperty(args[0]));
