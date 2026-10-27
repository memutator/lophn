// 설치된 Linux 묶음의 실제 확인이다.
//
//   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron tools/verify-linux-install.ts
//     [--root /opt/lophn] [--bin /usr/bin]
//
// core를 shell main과 같은 Electron의 Node로 띄우므로 이 도구도 같은 binary로 돈다.
// Ubuntu 24.04 이상에서 .deb를 설치한 뒤 부른다. 사람의 데이터 폴더는 절대 열지 않는다:
// 모든 실행은 이 도구가 만든 임시 HOME·LOPHN_HOME을 쓴다. `--root`에 `dpkg-deb -x`로 푼 임시
// 폴더를 줄 수도 있다. 미확인이 하나라도 있으면 Linux 배포를 사용 가능으로 표시하지 않는다.
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { linuxInstallLayout } from "../packages/core/install-and-update/mod.ts";
import { spawnCore } from "../packages/shell/main/desktop/core/supervise.ts";

type Verdict = "pass" | "fail" | "unverified";
const results: { name: string; verdict: Verdict; note: string }[] = [];

function record(name: string, verdict: Verdict, note = ""): void {
  results.push({ name, verdict, note });
  console.log(
    `${verdict.toUpperCase().padEnd(10)} ${name}${note ? ` — ${note}` : ""}`,
  );
}

function option(name: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const root = option("--root") ?? "/opt/lophn";
const bin = option("--bin") ?? "/usr/bin";
const layout = linuxInstallLayout(root);

// runLauncher는 부모 env를 물려받지 않는 것이 확인의 뜻이다. spawn은 넘긴 env만 쓴다.
async function run(
  command: string,
  args: string[],
  env: Record<string, string>,
): Promise<{ code: number | null; stdout: string }> {
  const child = spawn(command, args, {
    env,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const stdout: Buffer[] = [];
  child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("close", resolve);
    child.on("error", reject);
  });
  return { code, stdout: Buffer.concat(stdout).toString() };
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function checkLayout(): Promise<void> {
  const missing: string[] = [];
  for (const file of [
    layout.desktopBinary,
    layout.chromeSandbox,
    `${layout.platform}/package.json`,
    `${layout.platform}/package-lock.json`,
    `${layout.platform}/packages/core/main/daemon/main.ts`,
    `${layout.desktop}/desktop/index.html`,
  ]) {
    if (!(await isFile(file))) missing.push(file);
  }
  for (const dir of [
    `${layout.platform}/node_modules/@lophn/core`,
    `${layout.platform}/node_modules/@lophn/protocol`,
    layout.skills,
    layout.sdk,
  ]) {
    if (!(await isDir(dir))) missing.push(dir);
  }
  for (const name of ["lophn-desktop", "lophn"]) {
    try {
      // /usr/bin/lophn-desktop은 설치 root로 가는 링크라서 링크 자체를 본다.
      await lstat(`${bin}/${name}`);
    } catch {
      missing.push(`${bin}/${name}`);
    }
  }
  record(
    "R4·R6 설치 묶음 배치와 두 실행 이름",
    missing.length === 0 ? "pass" : "fail",
    missing.join(", "),
  );
}

async function tempHome(): Promise<{ home: string; data: string }> {
  const home = await mkdtemp(join(tmpdir(), "lophn-verify-"));
  const data = `${home}/.lophn`;
  await mkdir(data, { mode: 0o700 });
  return { home, data };
}

// launcher의 ROOT를 확인 대상 root로 바꾼 사본을 임시 HOME에서 실행한다(설치 위치면 그대로다).
async function runLauncher(
  name: string,
  args: string[],
): Promise<{ code: number | null; stdout: string }> {
  const { home, data } = await tempHome();
  try {
    const text = (await readFile(`${bin}/${name}`, "utf8")).replace(
      "ROOT=/opt/lophn",
      `ROOT=${root}`,
    );
    const script = `${home}/${name}`;
    await writeFile(script, text);
    await chmod(script, 0o755);
    return await run(script, args, {
      HOME: home,
      LOPHN_HOME: data,
      PATH: "/usr/bin:/bin",
    });
  } finally {
    await rm(home, { recursive: true }).catch(() => undefined);
  }
}

async function checkLaunchers(): Promise<void> {
  const text = await readFile(`${bin}/lophn`, "utf8");
  record(
    "R3·R6 launcher에 sandbox 해제가 없고 CLI를 Electron의 Node로 띄운다",
    /no-sandbox|disable-setuid-sandbox/.test(text) ||
      !text.includes("ELECTRON_RUN_AS_NODE=1")
      ? "fail"
      : "pass",
  );
  const cli = await runLauncher("lophn", ["help"]);
  record(
    "R6 lophn CLI가 설치된 Electron으로 시작",
    cli.code === 0 && cli.stdout.trim() !== "" ? "pass" : "fail",
  );
}

// shell main이 core를 띄우는 것과 같은 launch다.
async function startCore(home: string, data: string) {
  const core = spawnCore({
    repoRoot: layout.platform,
    dataRoot: data,
    env: { HOME: home, PATH: "" },
  });
  const hello = await Promise.race([
    core.hello,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("hello timeout")), 60_000),
    ),
  ]);
  return { core, hello };
}

async function stopCore(core: {
  stop(graceMs?: number): void;
  child: { pid?: number; exitCode: number | null };
}) {
  core.stop(5_000);
  for (let i = 0; i < 60 && core.child.exitCode === null; i++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function checkCoreOffline(): Promise<void> {
  const { home, data } = await tempHome();
  try {
    // 빈 PATH로 시작한다. core는 묶음의 node_modules만 읽고 설치본 밖의 도구를 부르지 않는다.
    const first = await startCore(home, data).catch((error) => error as Error);
    if (first instanceof Error) {
      record("R4·R8 의존성 다운로드 없는 core 시작", "fail", first.message);
      return;
    }
    record("R4·R8 빈 PATH로 core 시작", "pass");
    await stopCore(first.core);

    // 재시작해도 같은 data root를 그대로 쓴다.
    const before = await stat(`${data}/lophn.db`).then(
      (s) => s.size,
      () => -1,
    );
    const ledgerId = await readFile(`${data}/ledger-id`, "utf8").catch(
      () => "",
    );
    const second = await startCore(home, data).catch((error) => error as Error);
    if (second instanceof Error) {
      record("R8 재시작", "fail", second.message);
      return;
    }
    const after = await stat(`${data}/lophn.db`).then(
      (s) => s.size,
      () => -1,
    );
    const sameId =
      ledgerId !== "" &&
      ledgerId ===
        (await readFile(`${data}/ledger-id`, "utf8").catch(() => ""));
    record(
      "R8 재시작 뒤에도 H 유지",
      before > 0 && after > 0 && sameId ? "pass" : "fail",
    );
    await stopCore(second.core);
  } finally {
    await rm(home, { recursive: true }).catch(() => undefined);
  }
}

await checkLayout();
await checkLaunchers();
await checkCoreOffline();

const failed = results.filter((item) => item.verdict === "fail").length;
const unverified = results.filter(
  (item) => item.verdict === "unverified",
).length;
console.log(
  failed > 0
    ? `\n실패 ${failed}건: Linux 배포는 사용 가능이 아니다.`
    : unverified > 0
      ? `\n미확인 ${unverified}건: Ubuntu 설치에서 다시 확인하기 전에는 Linux 배포를 사용 가능으로 표시하지 않는다.`
      : "\n모든 항목 통과: 이 설치는 확인됐다(앱 호출은 flow install-lophn E2E가 따로 본다).",
);
process.exit(failed > 0 ? 1 : unverified > 0 ? 2 : 0);
