// Metro reads the protocol TypeScript source straight from packages/. Bare imports there (zod, @noble/*)
// resolve as if they came from this app, so they use packages/mobile/node_modules and never the root npm install.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const packages = path.resolve(__dirname, "..");
const config = getDefaultConfig(__dirname);
config.watchFolders = [packages];
// The vendor icons are the desktop's .svg files, read as text (src/parts/svg-text-transformer.js).
config.transformer.babelTransformerPath = path.join(__dirname, "src/parts/svg-text-transformer.js");
config.resolver.assetExts = config.resolver.assetExts.filter((ext) => ext !== "svg");
config.resolver.sourceExts = [...config.resolver.sourceExts, "svg"];
// The phone UI kit is an SDK part that lives next to the desktop kit; the app imports it by its package name.
const uiNative = path.join(packages, "design/native/mod.ts");
// The same message catalog as the desktop.
const i18n = path.join(packages, "design/i18n/mod.ts");
// The Inbox history the phone reuses (waiting/history.ts) takes only the date-range helpers from the desktop input kit;
// the rest of that kit is DOM, so the phone resolves the name to the plain helper file.
const dateRange = path.join(packages, "design/components/input/filter/range.ts");
config.resolver.resolveRequest = (context, name, platform) => {
  if (name === "@lophn/ui-native") return { type: "sourceFile", filePath: uiNative };
  if (name === "@lophn/i18n") return { type: "sourceFile", filePath: i18n };
  if (name === "@lophn/ui/input") return { type: "sourceFile", filePath: dateRange };
  const bare = !name.startsWith(".") && !path.isAbsolute(name);
  // This app lives inside packages/ too; its own files and node_modules resolve normally.
  const fromPackages =
    context.originModulePath.startsWith(`${packages}/`) &&
    !context.originModulePath.startsWith(`${__dirname}/`);
  return context.resolveRequest(
    bare && fromPackages
      ? { ...context, originModulePath: path.join(__dirname, "index.ts") }
      : context,
    name,
    platform,
  );
};

module.exports = config;
