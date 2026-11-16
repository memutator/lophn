// Builds the lab's fixture screens into <out>: each guest/fixtures/src/screens/<key>/phone.tsx the way core builds an
// app's phone screen (bundlePhone: esbuild, the host modules external, the evaluation inside try/catch) as <key>.js with
// its manifest <key>.json, and raw-throw.js as it is. Also the backend of an app that runs on the phone, the way release
// preparation builds one (buildPhoneBackend): local-backend.js, its manifest local-backend.json and its migration
// local-0-1.sql, and throw-backend.js as it is. Usage: node guest/build-fixtures.ts <out> <work>
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { installSdkCopies } from "../../core/apps/packages/install.ts";
import { syncAppSdk } from "../../core/apps/packages/sdk-sync.ts";
import { makeTreeWritable } from "../../core/apps/releases/bundle/seal.ts";
import { buildPhoneBackend } from "../../core/apps/releases/phone-backend/build.ts";
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

// The backend: tests/support/app/local with guest/fixtures/local/handlers.ts.tmpl as its handlers, staged the way
// release preparation stages an app (the SDK copies core installs, under .lophn/sdk, linked from node_modules).
const packages = join(import.meta.dirname, "../..");
const app = join(packages, "../tests/support/app/local");
const dataRoot = join(work, "data");
const staging = join(work, "local-app");
const installed = await installSdkCopies({ dataRoot, packagesRoot: packages });
if (!installed.ok) throw new Error(installed.error.message);
for (const entry of await readdir(app, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".tmpl")) continue;
  const path = join(entry.parentPath, entry.name).slice(app.length + 1);
  await mkdir(dirname(join(staging, path)), { recursive: true });
  await copyFile(join(app, path), join(staging, path.replace(/\.tmpl$/, "")));
}
await copyFile(join(fixtures, "local/handlers.ts.tmpl"), join(staging, "src/handlers.ts"));
const manifest = JSON.parse(await readFile(join(staging, "package.json"), "utf8"));
manifest.dependencies["@lophn/cap-net"] = `file:.lophn/sdk/cap-net/${await version("../../sdk/cap-net/package.json")}`;
await writeFile(join(staging, "package.json"), JSON.stringify(manifest));
const synced = await syncAppSdk(staging, dataRoot);
if (!synced.ok) throw new Error(synced.error.message);
await mkdir(join(staging, "node_modules/@lophn"), { recursive: true });
for (const path of synced.value) {
  const [, part = "", partVersion = ""] = path.split("/");
  await symlink(join(staging, ".lophn/sdk", part, partVersion), join(staging, "node_modules/@lophn", part));
}
const built = await buildPhoneBackend(staging, {
  operations: [
    { name: "list_items", effect: "read" },
    { name: "add_item", effect: "write" },
    { name: "send_report", effect: "external" },
    { name: "refuse_item", effect: "write" },
    { name: "try_offline", effect: "read" },
  ],
  commands: [],
});
if (!built.ok) throw new Error(built.error.message);
await copyFile(join(staging, "phone/backend.js"), join(out, "local-backend.js"));
await writeFile(join(out, "local-backend.json"), JSON.stringify(built.value.manifest));
await copyFile(join(staging, "migrations/0-1.sql"), join(out, "local-0-1.sql"));
await copyFile(join(fixtures, "throw-backend.js"), join(out, "throw-backend.js"));
// The SDK copies are read-only; build-base.sh removes this folder on the next build.
await makeTreeWritable(work);
