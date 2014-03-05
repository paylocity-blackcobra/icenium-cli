///<reference path=".d.ts"/>

import util = require("util");

export class AnalyticsService implements IAnalyticsService {
    private _eqatecMonitor: any = null;
    private static PRODUCT_KEY = "750a46a45109453c8b05b11de0d3a80b";

    constructor(private $config: IConfiguration,
        private $logger: ILogger) { }

    public start(): void {
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

            this._eqatecMonitor = eqatec._eqatecmonitor;

            console.log(eqatec);

            var settings = global._eqatec.createSettings(AnalyticsService.PRODUCT_KEY);
            settings.version = this.$config.version;
            settings.loggingInterface = global._eqatec.createTraceLogger();

            this._eqatecMonitor = eqatec._eqatecmonitor = global._eqatec.createMonitor(settings);
            eqatec._eqatecmonitor.start();
        } catch(e) {
            this.$logger.trace("Analytics exception: '%s'", e);
        }
    }

    public trackFeatureValue(featureName: string, featureValue: number): void {
        this._eqatecMonitor.trackFeatureValue(featureName, featureValue);
    }
}
$injector.register("analyticsService", AnalyticsService);