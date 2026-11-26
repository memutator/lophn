// agent shell의 `npm`(data root의 shim이 Electron의 Node로 띄운다). 의존을 까는 명령이면 npm보다 먼저 지금
// 폴더의 package.json이 거는 SDK 사본을 `.lophn/sdk`로 맞춘다. agent가 SDK 의존을 더하거나 판을 바꾼 뒤
// 바로 `npm install`이 그 사본을 찾게 한다. 사용: npm-entry.ts <data root> <npm 인자...>
import { stat } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { platformNpmCliPath } from "../../supervision/security/node-shims.ts";
import { syncAppSdk } from "./sdk-sync.ts";

const INSTALLS = new Set(["install", "i", "ci", "add", "update", "up"]);

const [dataRoot, ...args] = process.argv.slice(2);
if (dataRoot !== undefined && INSTALLS.has(args[0] ?? "")) {
  const hasManifest = await stat("package.json").then(
    () => true,
    () => false,
  );
  if (hasManifest) {
    const synced = await syncAppSdk(process.cwd(), dataRoot);
    // 맞추지 못해도 npm은 돈다. 풀리지 않는 SDK 의존은 npm 오류로 보인다.
    if (!synced.ok) console.error(`lophn: ${synced.error.message}`);
  }
}
const cli = platformNpmCliPath();
process.argv = [process.argv[0], cli, ...args];
await import(pathToFileURL(cli).href);
