(function initRuntimeConfig(windowObj) {
    const existingRuntimeConfig = windowObj.WA_GOLD_RUSH_RUNTIME_CONFIG || {};
    windowObj.WA_GOLD_RUSH_RUNTIME_CONFIG = {
        ...existingRuntimeConfig,
        version: existingRuntimeConfig.version || 'dev'
    };
    windowObj.WA_GOLD_RUSH_RUNTIME_CONFIG_SCRIPT_LOADED = true;
})(window);
