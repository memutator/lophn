// Metro turns every .svg into a module that exports the file's text, so the phone draws the desktop's vendor icons
// (packages/shell/renderer/parts/vendor-icon/) without a copy. Every other file goes to Expo's own transformer.
const path = require("node:path");

const expo = path.dirname(require.resolve("expo/package.json"));
const upstream = require(
  require.resolve("@expo/metro-config/build/babel-transformer.js", {
    paths: [expo],
  }),
);

module.exports.transform = (input) =>
  upstream.transform(
    input.filename.endsWith(".svg")
      ? { ...input, src: `module.exports = ${JSON.stringify(input.src)};` }
      : input,
  );
