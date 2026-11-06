// 실행: node tools/ci/boot-core.ts
// 새 data root로 core를 두 번 띄운다. 두 번째는 첫 boot가 남긴 data root로 다시 뜨는 것(재시작)이다.
// 각 boot는 hello가 오면 stdin을 닫고 exit 0을 본다. OS 어디서나 도는 CI 도구다.
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const TIMEOUT_MS = 40_000;
const ELECTRON = createRequire(import.meta.url)("electron") as string;
const ENTRY = fileURLToPath(
  new URL("../../packages/core/main/daemon/main.ts", import.meta.url),
);
const PASS_ENV = [
  "HOME",
  "PATH",
  "SystemRoot",
  "USERPROFILE",
  "TEMP",
  "TMP",
  "APPDATA",
  "LOCALAPPDATA",
];

function boot(dataRoot: string): Promise<{ code: number | null; err: string }> {
  const env: Record<string, string> = {
    ELECTRON_RUN_AS_NODE: "1",
    LOPHN_HOME: dataRoot,
  };
  for (const name of PASS_ENV) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return new Promise((resolve, reject) => {
    const child = spawn(ELECTRON, [ENTRY, "--port=0"], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let err = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => (err += chunk));
    // hello(혹은 start_failed)가 stdout의 첫 frame이다. 오면 stdin을 닫아 core를 끝낸다.
    child.stdout.once("data", () => child.stdin.end());
    const timer = setTimeout(() => {
      err += `\n${TIMEOUT_MS}ms 안에 안 끝나 끈다\n`;
      child.kill();
    }, TIMEOUT_MS);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, err });
    });
  });
}

// core가 깐 sdk 설치 사본은 읽기 전용(0555)이라 쓰기 권한을 돌려준 뒤 지운다.
async function remove(dir: string) {
  if (process.platform !== "win32") {
    await chmod(dir, 0o700);
    for (const entry of await readdir(dir, {
      recursive: true,
      withFileTypes: true,
    })) {
      if (entry.isDirectory())
        await chmod(join(entry.parentPath, entry.name), 0o700);
    }
  }
  await rm(dir, { recursive: true, force: true });
}

const dataRoot = await mkdtemp(join(tmpdir(), "lophn-boot-"));
let failed = false;
try {
  for (const i of [1, 2]) {
    const { code, err } = await boot(dataRoot);
    console.log(`boot ${i} exit ${code}`);
    if (code !== 0) {
      failed = true;
      console.log(err.split("\n").slice(-200).join("\n"));
      break;
    }
  }
} finally {
  await remove(dataRoot);
}
process.exit(failed ? 1 : 0);
