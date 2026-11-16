// Builds the lab's fixture screens into <out>: each guest/fixtures/src/screens/<key>/phone.tsx the way core builds an
// app's phone screen (bundlePhone: esbuild, the host modules external, the evaluation inside try/catch) as <key>.js with
// its manifest <key>.json, and raw-throw.js as it is. Usage: node guest/build-fixtures.ts <out> <work>
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bundlePhone } from "../../core/apps/releases/ui-build/phone/build.ts";
import { PHONE_BASE_FORMAT, phoneManifestSchema } from "../../protocol/apps/phone-screen.ts";

const [out, work] = process.argv.slice(2);
const fixtures = join(import.meta.dirname, "fixtures");
const version = async (file: string) =>
  (JSON.parse(await readFile(join(import.meta.dirname, file), "utf8")) as { version: string }).version;
const kit = {
  "@lophn/ui-native": await version("../../design/native/package.json"),
  "@lophn/app-ui-native": await version("../../sdk/app-ui-native/package.json"),
};
await mkdir(out, { recursive: true });
for (const key of await readdir(join(fixtures, "src/screens"))) {
  const modules = await bundlePhone(fixtures, key, join(work, key));
  const js = await readFile(join(work, key, "phone.js"));
  await writeFile(join(out, `${key}.js`), js);
  const manifest = phoneManifestSchema.parse({
    format: 1,
    entry: "phone.js",
    size: js.byteLength,
    sha256: createHash("sha256").update(js).digest("hex"),
    base: PHONE_BASE_FORMAT,
    kit,
    modules,
  });
  await writeFile(join(out, `${key}.json`), JSON.stringify(manifest));
}
await copyFile(join(fixtures, "raw-throw.js"), join(out, "raw-throw.js"));

// big.js: about 200 KB of plain JS in 1,500 functions, wrapped like a built screen, to time a large screen's start.
const parts = Array.from(
  { length: 1500 },
  (_, i) =>
    `function f${i}(a){var s=${i};for(var j=0;j<a.length;j++){s=(s*31+a.charCodeAt(j))%1000003}return {n:${i},s:s,label:"value ${i} ".concat(a)}}`,
);
const big = `try{(function(){var r=require("react"),n=require("react-native");${parts.join("")}
var all=[${parts.map((_, i) => `f${i}`).join(",")}];
function Screen(){var t=all.reduce(function(s,f){return s+f("x").s},0);return r.createElement(n.Text,{style:{padding:24}},"big screen "+all.length+" "+t)}
globalThis.__lophnMount(Screen)})()}catch(e){globalThis.__lophnFatal&&globalThis.__lophnFatal(e)}`;
await writeFile(join(out, "big.js"), big);
