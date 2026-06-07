const store = require("./utils/store");
const cloudConfig = require("./utils/cloudConfig");

App({
  onLaunch() {
    store.ensureSeedData();
    if (cloudConfig.enabled) {
      store.initCloudSync(cloudConfig).catch((error) => {
        console.warn("cloud sync init failed", error);
      });
    }
  }
});
