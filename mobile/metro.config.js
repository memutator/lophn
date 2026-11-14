// Metro reads the protocol TypeScript source straight from packages/. Bare imports there (zod, @noble/*)
// resolve as if they came from this app, so they use mobile/node_modules and never the root npm install.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const packages = path.resolve(__dirname, "../packages");
const config = getDefaultConfig(__dirname);
config.watchFolders = [packages];
config.resolver.resolveRequest = (context, name, platform) => {
  const bare = !name.startsWith(".") && !path.isAbsolute(name);
  const fromPackages = context.originModulePath.startsWith(`${packages}/`);
  return context.resolveRequest(
    bare && fromPackages
      ? { ...context, originModulePath: path.join(__dirname, "index.ts") }
      : context,
    name,
    platform,
  );
};

module.exports = config;
