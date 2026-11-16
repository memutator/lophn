// Metro reads the protocol TypeScript source straight from packages/. Bare imports there (zod, @noble/*)
// resolve as if they came from this app, so they use packages/mobile/node_modules and never the root npm install.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const packages = path.resolve(__dirname, "..");
// The product has one version, the root package.json's. Settings › About shows it; the file itself is outside Metro's folders.
process.env.EXPO_PUBLIC_LOPHN_VERSION = require("../../package.json").version;
const config = getDefaultConfig(__dirname);
config.watchFolders = [packages];
// The vendor icons are the desktop's .svg files, read as text (src/parts/svg-text-transformer.js).
config.transformer.babelTransformerPath = path.join(__dirname, "src/parts/svg-text-transformer.js");
config.resolver.assetExts = config.resolver.assetExts.filter((ext) => ext !== "svg");
config.resolver.sourceExts = [...config.resolver.sourceExts, "svg"];
// The phone UI kit is an SDK part that lives next to the desktop kit; the app imports it by its package name.
const uiNative = path.join(packages, "design/native/mod.ts");
// The phone screen hooks, an SDK part; the base bundle of the guest runtime serves it to app screens. Its hooks are files
// of the desktop app-ui part (../app-ui/use-*.ts), which resolve as plain relative imports.
const appUiNative = path.join(packages, "sdk/app-ui-native/mod.ts");
// The same message catalog as the desktop.
const i18n = path.join(packages, "design/i18n/mod.ts");
// The Inbox history the phone reuses (waiting/history.ts) takes only the date-range helpers from the desktop input kit;
// the rest of that kit is DOM, so the phone resolves the name to the plain helper file.
const dateRange = path.join(packages, "design/components/input/filter/range.ts");
// guest/build-base.sh builds the guest base bundle with LOPHN_GUEST_BASE=1. A guest has no Expo modules; the kit's copy
// button takes a stub there.
const guestBase = process.env.LOPHN_GUEST_BASE === "1";
// A build with EXPO_PUBLIC_LOPHN_GUEST_LAB=1 opens the guest runtime lab (guest/lab) instead of the app.
const guestLab = process.env.EXPO_PUBLIC_LOPHN_GUEST_LAB === "1";
const entry = path.join(__dirname, "index.ts");
// A guest does not set the app's status bar (guest/stubs/status-bar.ts); React Native's StatusBar is swapped wherever it
// is imported from.
const statusBar = path.join(
  path.dirname(require.resolve("react-native/package.json")),
  "Libraries/Components/StatusBar/StatusBar.js",
);
config.resolver.resolveRequest = (context, name, platform) => {
  const resolved = resolve(context, name, platform);
  if (guestBase && resolved.type === "sourceFile" && resolved.filePath === statusBar)
    return { type: "sourceFile", filePath: path.join(__dirname, "guest/stubs/status-bar.ts") };
  return resolved;
};

function resolve(context, name, platform) {
  if (guestBase && name === "expo-clipboard")
    return { type: "sourceFile", filePath: path.join(__dirname, "guest/stubs/expo-clipboard.ts") };
  if (guestLab && name === "./App.tsx" && context.originModulePath === entry)
    return { type: "sourceFile", filePath: path.join(__dirname, "guest/lab/lab.tsx") };
  if (name === "@lophn/app-ui-native") return { type: "sourceFile", filePath: appUiNative };
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
}

module.exports = config;
