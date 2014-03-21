///<reference path=".d.ts"/>

import util = require("util");
import path = require("path");

export class AnalyticsService implements IAnalyticsService {
    private _eqatecMonitor: any = null;

	private userSettingsFile = null;
	private userSettingsData = {};

	private static PRODUCT_KEY = "750a46a45109453c8b05b11de0d3a80b";

    constructor(private $config: IConfiguration,
        private $logger: ILogger,
		private $prompter: IPrompter,
		private $fs: IFileSystem) {
		this.userSettingsFile = path.join(process.cwd(), "user-settings.json");
	}

    public start(): IFuture<void> {
		return(() => {
			try {
				var userAgentString = util.format("AppBuilderCLI/%s (Node.js %s; %s; %s)",
					this.$config.version,
					process.versions.node, process.platform, process.arch);

				global.navigator = {
					userAgent: userAgentString
				};

				global.XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;

				var eqatec = require("./../vendor/EqatecMonitor");

				if(eqatec._eqatecmonitor) {
					return;
				}

				console.log(eqatec);

				if(!this.$fs.exists(this.userSettingsFile).wait()) {
					this.showConsentPrompt().wait();
				}

				var settings = global._eqatec.createSettings(AnalyticsService.PRODUCT_KEY);
				settings.version = this.$config.version;
				settings.loggingInterface = global._eqatec.createTraceLogger();

				this._eqatecMonitor = eqatec._eqatecmonitor = global._eqatec.createMonitor(settings);
				eqatec._eqatecmonitor.start();
			} catch(e) {
				this.$logger.trace("Analytics exception: '%s'", e);
			}
		}).future<void>()();
    }

    public trackFeatureValue(featureName: string, featureValue: number): void {
        this._eqatecMonitor.trackFeatureValue(featureName, featureValue);
    }

	public showConsentPrompt(): IFuture<void> {
		return(() => {
			var isConfirmed = this.$prompter.confirm(util.format("We're constantly looking for ways to make Appbuilder CLI better!May we anonymously report usage statistics to improve the tool over time?")).wait();
			this.userSettingsData["enableAnalytics"] = isConfirmed;
			this.$fs.writeJson(this.userSettingsFile, this.userSettingsData, "\t").wait();
		}).future<void>()();
	}

	private getUserSettingsFileSchema(): IFuture<any> {
		return (() => {
			this.userSettingsData = this.$fs.readJson(this.userSettingsFile).wait();
			return this.userSettingsData;
		}).future<any>()();
	}

	public enableAnalytics(): IFuture<void> {
		return(() => {
			this.getUserSettingsFileSchema();
			this.userSettingsData["enableAnalytics"] = true;
			this.$fs.writeJson(this.userSettingsFile, this.userSettingsData, "\t");
		}).future<void>()();
	}

	public disableAnalytics(): IFuture<void> {
		return(() => {
			this.getUserSettingsFileSchema();
			this.userSettingsData["enableAnalytics"] = false;
			this.$fs.writeJson(this.userSettingsFile, this.userSettingsData, "\t");
		}).future<void>()();
	}
}
$injector.register("analyticsService", AnalyticsService);