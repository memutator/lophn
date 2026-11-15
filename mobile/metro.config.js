// Metro reads the protocol TypeScript source straight from packages/. Bare imports there (zod, @noble/*)
// resolve as if they came from this app, so they use mobile/node_modules and never the root npm install.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const packages = path.resolve(__dirname, "../packages");
const config = getDefaultConfig(__dirname);
config.watchFolders = [packages];
// The phone UI kit is an SDK part that lives next to the desktop kit; the app imports it by its package name.
const uiNative = path.join(packages, "design/native/mod.ts");
// The same message catalog as the desktop.
const i18n = path.join(packages, "design/i18n/mod.ts");
config.resolver.resolveRequest = (context, name, platform) => {
  if (name === "@lophn/ui-native") return { type: "sourceFile", filePath: uiNative };
  if (name === "@lophn/i18n") return { type: "sourceFile", filePath: i18n };
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
