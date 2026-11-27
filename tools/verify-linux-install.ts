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
import { setTimeout as sleep } from "node:timers/promises";
import { cliDial } from "../packages/cli/connection/client/node.ts";
import { linuxInstallLayout } from "../packages/core/install-and-update/mod.ts";
import {
  CONTROL_REQUEST_TIMEOUT_MS,
  controlConnect,
  controlIdentify,
  controlStop,
} from "../packages/protocol/client/mod.ts";

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
    `${layout.platform}/dist/daemon.mjs`,
    `${layout.desktop}/desktop/index.html`,
  ]) {
    if (!(await isFile(file))) missing.push(file);
  }
  for (const dir of [
    // @lophn member는 tools/package/main.ts가 선언에서 정한다. 실제로 풀리는지는 checkAppEntrypoint와 core 시작이 본다.
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

type CoreRun = {
  /** control stop을 보내고 core가 끝나기를 기다린다. 끝나지 않으면 SIGKILL하고 null을 돌려준다. */
  stop(): Promise<number | null>;
};

const EXIT_MS = 15_000;

// 설치본 core의 stdout 첫 줄 하나. READY_MS 안에 오지 않으면 실패다.
function firstLine(stream: NodeJS.ReadableStream): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  let data = "";
  const done = () => {
    clearTimeout(timer);
    stream.off("data", onData);
    stream.off("end", onEnd);
    stream.off("error", onError);
    // pipe를 놓은 뒤의 오류(core가 쓴 뒤 닫힘)로 이 도구가 죽지 않게 한다.
    stream.on("error", () => {});
  };
  const onData = (text: string) => {
    data += text;
    const end = data.indexOf("\n");
    if (end < 0) return;
    done();
    resolve(data.slice(0, end));
  };
  const onEnd = () => {
    done();
    reject(new Error("core가 첫 줄을 쓰기 전에 stdout을 닫았다"));
  };
  const onError = (error: Error) => {
    done();
    reject(error);
  };
  const timer = setTimeout(() => {
    done();
    reject(new Error("60초 안에 core의 첫 줄이 오지 않았다"));
  }, 60_000);
  stream.setEncoding("utf8");
  stream.on("data", onData);
  stream.on("end", onEnd);
  stream.on("error", onError);
  return promise;
}

// shell이나 CLI 없이 설치본의 core를 직접 띄운다. stdout 첫 줄(`ready`) 뒤 control
// identify·connect로 붙는다. core의 env에 XDG_RUNTIME_DIR이 없으므로 dial도 그것 없이 만든다.
async function startCore(home: string, data: string): Promise<CoreRun> {
  const child = spawn(
    layout.desktopBinary,
    [`${layout.platform}/dist/daemon.mjs`, "--port=0"],
    {
      cwd: layout.platform,
      // 빈 PATH로 시작한다. core는 묶음의 node_modules만 읽고 설치본 밖의 도구를 부르지 않는다.
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        HOME: home,
        LOPHN_HOME: data,
        PATH: "",
      },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (child.pid === undefined) throw new Error("core process를 띄우지 못했다");
  const exitCode = new Promise<number | null>((resolve) => {
    child.on("exit", (code) => resolve(code));
    child.on("error", () => resolve(null));
  });
  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => (stderr += chunk));
  // pipe를 놓아야 core가 이 도구의 읽기에 묶이지 않는다.
  const line = await firstLine(child.stdout!).catch(async (error) => {
    child.kill("SIGKILL");
    await exitCode;
    throw new Error(`${error.message}\n${stderr.slice(-2000)}`);
  });
  child.stdout!.destroy();
  let startType: unknown;
  try {
    const parsed = JSON.parse(line) as { type?: unknown };
    startType = parsed.type;
  } catch {
    startType = undefined;
  }
  if (startType !== "ready") {
    await exitCode;
    // 줄 내용은 남기지 않는다. 계약 밖 첫 줄에는 credential이 섞여 있을 수 있다.
    throw new Error(`core가 ready를 알리지 않았다\n${stderr.slice(-2000)}`);
  }
  const dial = cliDial({
    dataRoot: data,
    platform: process.platform,
    xdgRuntimeDir: undefined,
  });
  if (!dial.ok) {
    child.kill("SIGKILL");
    await exitCode;
    throw new Error(`control socket 경로: ${dial.error.message}`);
  }
  const deps = { dial: dial.value, timeoutMs: CONTROL_REQUEST_TIMEOUT_MS };
  const identified = await controlIdentify(deps);
  if (!identified.ok || identified.value.state !== "ready") {
    child.kill("SIGKILL");
    await exitCode;
    throw new Error(
      `core control identify: ${
        identified.ok ? identified.value.state : identified.error.message
      }\n${stderr.slice(-2000)}`,
    );
  }
  const connected = await controlConnect(deps, "cli");
  if (!connected.ok) {
    child.kill("SIGKILL");
    await exitCode;
    throw new Error(
      `core control connect: ${connected.error.code}: ${connected.error.message}`,
    );
  }
  return {
    async stop() {
      const stopped = await controlStop(deps);
      if (!stopped.ok) {
        child.kill("SIGKILL");
        await exitCode;
        return null;
      }
      const deadline = Date.now() + EXIT_MS;
      while (child.exitCode === null && child.signalCode === null) {
        if (Date.now() > deadline) {
          child.kill("SIGKILL");
          await exitCode;
          return null;
        }
        await sleep(100);
      }
      return exitCode;
    },
  };
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
    const firstExit = await first.stop();
    record(
      "R4·R8 빈 PATH로 core 시작",
      firstExit === 0 ? "pass" : "fail",
      firstExit === 0 ? "" : `정상 종료 exit ${firstExit}`,
    );
    if (firstExit !== 0) return;

    // 재시작해도 같은 data root를 그대로 쓴다. 첫째가 끝난 뒤에 둘째를 띄운다.
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
    const secondExit = await second.stop();
    if (secondExit !== 0) {
      record("R8 재시작", "fail", `정상 종료 exit ${secondExit}`);
    }
  } finally {
    await rm(home, { recursive: true }).catch(() => undefined);
  }
}

// 앱 process 진입점의 module graph가 설치본 안에서 풀리는지 본다. supervisor가 앱을 띄울 때
// 처음 import하는 module이고, 풀리지 않으면 모든 앱이 "exited before ready"로 끝난다.
// import만 하고 `run`은 부르지 않는다. 대상은 `--root`로 정한 설치본이라 자식 process에서 경로로 불러온다.
async function checkAppEntrypoint(): Promise<void> {
  const entry = `${layout.platform}/dist/app-entrypoint.mjs`;
  const script = `await import(${JSON.stringify(entry)});`;
  const loaded = await run(
    layout.desktopBinary,
    ["--input-type=module", "-e", script],
    { ELECTRON_RUN_AS_NODE: "1" },
  );
  record(
    "R4 앱 진입점이 설치본의 의존만으로 풀린다",
    loaded.code === 0 ? "pass" : "fail",
    loaded.code === 0 ? "" : `exit ${loaded.code}`,
  );
}

await checkLayout();
await checkLaunchers();
await checkCoreOffline();
await checkAppEntrypoint();

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
