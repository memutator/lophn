// `npm run e2e:deps`. E2E의 release 준비가 staging에서 받는 npm 의존을 e2eNpmCache()에 미리 받는다. network를
// 쓰는 유일한 명령이다. 무엇을 받는지는 추측하지 않고 코드로 정한다: 내장 template 앱을 새 data root에서
// 실제로 release 준비까지 지나 본다. `--offline`은 같은 준비를 다시 돌려 받은 것만으로 되는지 보는 단계로,
// network를 끊은 곳에서 돌린다: `unshare -rn sh -c 'ip link set lo up && npm run e2e:deps -- --offline'`.
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

import {
  createIdSource,
  cryptoRandom,
  systemClock,
} from "../../../packages/base/mod.ts";
import { installSdkCopies } from "../../../packages/core/apps/packages/install.ts";
import { syncAppSdk } from "../../../packages/core/apps/packages/sdk-sync.ts";
import { builtinTemplate } from "../../../packages/core/apps/packages/template/files.ts";
import { installBuiltinTemplate } from "../../../packages/core/apps/packages/template/install.ts";
import { scaffoldApp } from "../../../packages/core/apps/packages/template/scaffold.ts";
import { prepareFromSource } from "../../../packages/core/apps/releases/prepare/from-source.ts";
import { npmCommand } from "../../../packages/core/supervision/security/node-command.ts";
import { e2eNpmCache } from "./deps.ts";

const REPO = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const PACKAGES = `${REPO}/packages/`;

async function git(cwd: string, ...args: string[]): Promise<string> {
  const child = spawn(
    "git",
    [
      "-c",
      "user.name=e2e",
      "-c",
      "user.email=e2e@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const stdout: string[] = [];
  const stderr: string[] = [];
  child.stdout!.setEncoding("utf8");
  child.stderr!.setEncoding("utf8");
  child.stdout!.on("data", (chunk: string) => stdout.push(chunk));
  child.stderr!.on("data", (chunk: string) => stderr.push(chunk));
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (exitCode) => resolve(exitCode));
  });
  if (code !== 0) {
    throw new Error(`git ${args.join(" ")}: ${stderr.join("")}`);
  }
  return stdout.join("").trim();
}

// sdk 사본이 읽기 전용(폴더 0555)이라 폴더마다 쓰기 권한을 돌려준 뒤 지운다.
async function removeDir(dir: string): Promise<void> {
  async function open(directory: string): Promise<void> {
    await chmod(directory, 0o755);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) await open(`${directory}/${entry.name}`);
    }
  }
  await open(dir);
  await rm(dir, { recursive: true });
}

async function runNpm(cwd: string, args: readonly string[]): Promise<void> {
  const command = npmCommand(args);
  const child = spawn(command.command, command.args, {
    cwd,
    env: { ...process.env, ...command.env },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (exitCode) => resolve(exitCode));
  });
  if (code !== 0) {
    throw new Error(`npm ${args.join(" ")}가 ${code}로 끝났다`);
  }
}

async function hasLock(dir: string): Promise<boolean> {
  try {
    return (await stat(`${dir}/package-lock.json`)).isFile();
  } catch {
    return false;
  }
}

const offline = process.argv.slice(2).includes("--offline");
const cache = e2eNpmCache();
await mkdir(cache, { recursive: true });
// prepareFromSource와 그 자식의 npm은 이 process 환경에서 cache를 읽는다.
process.env["npm_config_cache"] = cache;
process.env["npm_config_audit"] = "false";
process.env["npm_config_fund"] = "false";
process.env["npm_config_update_notifier"] = "false";
if (offline) process.env["npm_config_offline"] = "true";

const dataRoot = await mkdtemp(join(`${REPO}/.dev-data/e2e`, "deps-"));
try {
  const sdk = await installSdkCopies({ dataRoot, packagesRoot: PACKAGES });
  if (!sdk.ok) throw new Error(`sdk 사본: ${sdk.error.message}`);
  const template = await installBuiltinTemplate({ dataRoot });
  if (!template.ok) throw new Error(`template: ${template.error.message}`);

  const files = await builtinTemplate(`${dataRoot}/templates/app`);
  if (!files.ok) throw new Error(`template: ${files.error.message}`);
  const sourceRoot = `${dataRoot}/work/deps-app`;
  const scaffolded = await scaffoldApp({
    files: files.value,
    dir: sourceRoot,
    app: "deps-app",
    dataRoot,
  });
  if (!scaffolded.ok) throw new Error(`scaffold: ${scaffolded.error.message}`);

  // release 준비는 staging에서 SDK 사본을 채운 뒤 lock이 있으면 npm ci, 없으면 npm install로 받는다. 같은 길을
  // 여기서 한 번 지나야 cache가 채워져 offline에서도 그 길이 된다.
  const synced = await syncAppSdk(sourceRoot, dataRoot);
  if (!synced.ok) throw new Error(`sdk 사본: ${synced.error.message}`);
  await runNpm(sourceRoot, (await hasLock(sourceRoot)) ? ["ci"] : ["install"]);

  await git(sourceRoot, "init", "-q");
  await git(sourceRoot, "add", "-A");
  await git(sourceRoot, "commit", "-q", "-m", "deps");
  const commit = await git(sourceRoot, "rev-parse", "HEAD");

  const prepared = await prepareFromSource({
    dataRoot,
    app: createIdSource({ clock: systemClock, random: cryptoRandom }).newId(
      "app",
    ),
    sourceRoot,
    commit,
  });
  if (!prepared.ok) {
    throw new Error(
      `release 준비 실패: ${prepared.error.code} ${prepared.error.reason}`,
    );
  }
  console.log(
    `${offline ? "offline " : ""}release 준비 통과. 의존은 ${cache}에 있다.`,
  );
} finally {
  await removeDir(dataRoot).catch(() => undefined);
}
