// 설치된 Linux 묶음의 실제 확인이다.
//
//   deno run --allow-all tools/verify-linux-install.ts [--root /opt/lophn] [--bin /usr/bin]
//
// Ubuntu 24.04 이상에서 .deb를 설치한 뒤 부른다. 사람의 데이터 폴더는 절대 열지 않는다:
// 모든 실행은 이 도구가 만든 임시 HOME·LOPHN_HOME을 쓴다. `--root`에 `dpkg-deb -x`로 푼 임시
// 폴더를 줄 수도 있다: 그때 root 소유·4755와 실제 sandbox 항목은 통과가 아니라 "미확인"이고,
// 미확인이 하나라도 있으면 Linux 배포를 사용 가능으로 표시하지 않는다.
import { spawnCore } from "../packages/shell/main/desktop/core/supervise.ts";
import {
  checkRunningSandbox,
  checkSandboxFile,
  credentialSocketPath,
  linuxInstallLayout,
  linuxProcReader,
} from "../packages/core/install-and-update/mod.ts";

type Verdict = "pass" | "fail" | "unverified";
const results: { name: string; verdict: Verdict; note: string }[] = [];

function record(name: string, verdict: Verdict, note = ""): void {
  results.push({ name, verdict, note });
  console.log(
    `${verdict.toUpperCase().padEnd(10)} ${name}${note ? ` — ${note}` : ""}`,
  );
}

function option(name: string): string | undefined {
  const index = Deno.args.indexOf(name);
  return index >= 0 ? Deno.args[index + 1] : undefined;
}

const root = option("--root") ?? "/opt/lophn";
const bin = option("--bin") ?? "/usr/bin";
const layout = linuxInstallLayout(root);

async function isFile(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch {
    return false;
  }
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isDirectory;
  } catch {
    return false;
  }
}

async function checkLayout(): Promise<void> {
  const missing: string[] = [];
  for (
    const file of [
      layout.deno,
      layout.credentialHelper,
      layout.desktopBinary,
      layout.chromeSandbox,
      `${layout.platform}/deno.json`,
      `${layout.platform}/deno.lock`,
      `${layout.platform}/packages/core/main/daemon/main.ts`,
      `${layout.desktop}/desktop/index.html`,
    ]
  ) {
    if (!await isFile(file)) missing.push(file);
  }
  for (
    const dir of [
      layout.platform + "/vendor",
      layout.platform + "/node_modules",
      layout.skills,
      layout.guides,
      layout.sdk,
    ]
  ) {
    if (!await isDir(dir)) missing.push(dir);
  }
  for (const name of ["lophn-desktop", "lophn", "lophn-mcp"]) {
    try {
      // /usr/bin/lophn-desktop은 설치 root로 가는 링크라서 링크 자체를 본다.
      await Deno.lstat(`${bin}/${name}`);
    } catch {
      missing.push(`${bin}/${name}`);
    }
  }
  record(
    "R4·R6 설치 묶음 배치와 세 실행 이름",
    missing.length === 0 ? "pass" : "fail",
    missing.join(", "),
  );
}

async function checkSandboxFiles(): Promise<boolean> {
  const stat = await Deno.stat(layout.chromeSandbox);
  const checked = checkSandboxFile({
    uid: stat.uid ?? -1,
    gid: stat.gid ?? -1,
    mode: stat.mode ?? 0,
  });
  if (checked.ok) {
    record("R3 chrome-sandbox root 소유 4755", "pass");
    return true;
  }
  // 풀어 놓은 폴더(소유자가 root가 아님)는 설치가 아니다.
  record(
    "R3 chrome-sandbox root 소유 4755",
    "unverified",
    checked.reasons.join("; "),
  );
  return false;
}

// 시스템 Deno 없이(PATH 비움) 설치된 Deno만으로 시작한다.
async function denoRuns(): Promise<void> {
  const out = await new Deno.Command(layout.deno, {
    args: ["--version"],
    clearEnv: true,
    env: { PATH: "" },
  }).output();
  record("R5 설치된 Deno 실행(PATH 없음)", out.success ? "pass" : "fail");
}

async function tempHome(): Promise<{ home: string; data: string }> {
  const home = await Deno.makeTempDir({ prefix: "lophn-verify-" });
  const data = `${home}/.lophn`;
  await Deno.mkdir(data, { mode: 0o700 });
  return { home, data };
}

// launcher의 ROOT를 확인 대상 root로 바꾼 사본을 임시 HOME에서 실행한다(설치 위치면 그대로다).
async function runLauncher(
  name: string,
  args: string[],
  stdin?: string,
): Promise<{ code: number; stdout: string }> {
  const { home, data } = await tempHome();
  try {
    const text = (await Deno.readTextFile(`${bin}/${name}`)).replace(
      "ROOT=/opt/lophn",
      `ROOT=${root}`,
    );
    const script = `${home}/${name}`;
    await Deno.writeTextFile(script, text);
    await Deno.chmod(script, 0o755);
    const child = new Deno.Command(script, {
      args,
      env: { HOME: home, LOPHN_HOME: data, PATH: "/usr/bin:/bin" },
      clearEnv: true,
      stdin: "piped",
      stdout: "piped",
      stderr: "null",
    }).spawn();
    const writer = child.stdin.getWriter();
    if (stdin !== undefined) {
      await writer.write(new TextEncoder().encode(stdin));
    }
    await writer.close();
    const out = await child.output();
    return { code: out.code, stdout: new TextDecoder().decode(out.stdout) };
  } finally {
    await Deno.remove(home, { recursive: true }).catch(() => undefined);
  }
}

async function checkLaunchers(): Promise<void> {
  const bad: string[] = [];
  for (const name of ["lophn", "lophn-mcp"]) {
    const text = await Deno.readTextFile(`${bin}/${name}`);
    if (/no-sandbox|disable-setuid-sandbox|--allow-all|\s-A\s/.test(text)) {
      bad.push(name);
    }
  }
  record(
    "R3·R6 launcher에 sandbox 해제·전체 권한이 없다",
    bad.length === 0 ? "pass" : "fail",
    bad.join(", "),
  );
  const cli = await runLauncher("lophn", ["help"]);
  record(
    "R6 lophn CLI가 설치된 Deno로 cached-only 시작",
    cli.stdout.includes("commands:") ? "pass" : "fail",
  );
  const initialize = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "verify", version: "1" },
    },
  };
  const mcp = await runLauncher(
    "lophn-mcp",
    [],
    JSON.stringify(initialize) + "\n",
  );
  record(
    "R6 lophn-mcp가 설치된 Deno로 cached-only 시작·initialize 응답",
    mcp.stdout.includes('"serverInfo":{"name":"lophn-mcp"') ? "pass" : "fail",
  );
}

// shell main이 core를 띄우는 것과 같은 launch(packaged flag, 설치된 Deno, DENO_DIR)다.
async function startCore(home: string, data: string) {
  const core = spawnCore({
    repoRoot: layout.platform,
    dataRoot: data,
    denoBinary: layout.deno,
    packaged: true,
    env: { HOME: home, DENO_DIR: `${home}/.cache/lophn/deno`, PATH: "" },
  });
  const hello = await Promise.race([
    core.hello,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("hello timeout")), 60_000)
    ),
  ]);
  return { core, hello };
}

async function stopCore(
  core: {
    stop(graceMs?: number): void;
    child: { pid?: number; exitCode: number | null };
  },
) {
  core.stop(5_000);
  for (let i = 0; i < 60 && core.child.exitCode === null; i++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function checkCoreOffline(): Promise<void> {
  const { home, data } = await tempHome();
  try {
    // 새 cache로 의존성 다운로드 없이(--cached-only) 시작한다. PATH도 비워 system Deno가 없다.
    const first = await startCore(home, data).catch((error) => error as Error);
    if (first instanceof Error) {
      record("R4·R5·R8 cached-only core 시작", "fail", first.message);
      return;
    }
    record("R4·R5 새 cache·system Deno 없이 cached-only core 시작", "pass");
    const socket = credentialSocketPath(data);
    const sock = await Deno.lstat(socket).then(
      (stat) => stat.isSocket,
      () => false,
    );
    record("보호 통로 socket 열림(소유자 전용)", sock ? "pass" : "fail");
    const helper = await runHelper(home, data);
    record(
      "R6 helper → core: 등록되지 않은 child는 not_found",
      helper.code === 1 && helper.stdout === '{"reason":"not_found"}'
        ? "pass"
        : "fail",
      helper.stdout,
    );
    await stopCore(first.core);
    const down = await runHelper(home, data);
    record(
      "R6 helper: core 없으면 no_secret_service(평문 fallback 없음)",
      down.code === 1 && down.stdout === '{"reason":"no_secret_service"}'
        ? "pass"
        : "fail",
      down.stdout,
    );

    // Deno cache를 지워도 H는 그대로다.
    const before = await Deno.stat(`${data}/lophn.db`).then(
      (s) => s.size,
      () => -1,
    );
    const ledgerId = await Deno.readTextFile(`${data}/ledger-id`).catch(() =>
      ""
    );
    await Deno.remove(`${home}/.cache/lophn/deno`, { recursive: true });
    const second = await startCore(home, data).catch((error) => error as Error);
    if (second instanceof Error) {
      record("R8 cache 삭제 뒤 재시작", "fail", second.message);
      return;
    }
    const after = await Deno.stat(`${data}/lophn.db`).then(
      (s) => s.size,
      () => -1,
    );
    const sameId = ledgerId !== "" &&
      ledgerId === await Deno.readTextFile(`${data}/ledger-id`).catch(() => "");
    record(
      "R8 cache 삭제 뒤에도 H 유지·재시작",
      before > 0 && after > 0 && sameId ? "pass" : "fail",
    );
    await stopCore(second.core);
  } finally {
    await Deno.remove(home, { recursive: true }).catch(() => undefined);
  }
}

async function runHelper(home: string, data: string) {
  const child = new Deno.Command(layout.credentialHelper, {
    env: { HOME: home, LOPHN_HOME: data },
    clearEnv: true,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(
    new TextEncoder().encode(JSON.stringify({
      connection: "cac_01arz3ndektsv4rrffq69g5fav",
      process_generation: "verify",
      loader_identity: layout.credentialHelper,
      purpose: "mcp_cli_loader",
    })),
  );
  await writer.close();
  const out = await child.output();
  return { code: out.code, stdout: new TextDecoder().decode(out.stdout) };
}

// 설치된 Electron을 headless로 띄워 renderer가 실제 sandbox 안에 있는지 /proc으로 본다.
async function checkRealSandbox(): Promise<void> {
  const { home, data } = await tempHome();
  const child = new Deno.Command(layout.desktopBinary, {
    env: {
      HOME: home,
      LOPHN_HOME: data,
      LOPHN_SHELL_HEADLESS: "1",
    },
    // 사용자 session 환경(DBUS·XDG)은 그대로 쓴다. 데이터 위치만 임시 폴더로 덮는다.
    stdout: "null",
    stderr: "null",
  }).spawn();
  try {
    const proc = linuxProcReader({
      readTextFile: (path) => Deno.readTextFileSync(path),
      readLink: (path) => Deno.readLinkSync(path),
    });
    let checked = checkRunningSandbox(child.pid, proc);
    for (let i = 0; i < 60 && !checked.ok; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      checked = checkRunningSandbox(child.pid, proc);
    }
    record(
      "R3·security#R4 실제 sandbox 활성(renderer seccomp·namespace)",
      checked.ok ? "pass" : "fail",
      checked.ok ? "" : checked.reasons.join("; "),
    );
  } finally {
    try {
      child.kill("SIGTERM");
    } catch { /* 이미 끝났다 */ }
    await child.status.catch(() => undefined);
    await Deno.remove(home, { recursive: true }).catch(() => undefined);
  }
}

await checkLayout();
await denoRuns();
await checkLaunchers();
await checkCoreOffline();
const installed = await checkSandboxFiles();
if (installed) {
  await checkRealSandbox();
} else {
  record(
    "R3·security#R4 실제 sandbox 활성",
    "unverified",
    "설치(root 소유 4755) 전이라 실행하지 않는다. sandbox를 끈 실행은 통과가 아니다",
  );
}

const failed = results.filter((item) => item.verdict === "fail").length;
const unverified =
  results.filter((item) => item.verdict === "unverified").length;
console.log(
  failed > 0
    ? `\n실패 ${failed}건: Linux 배포는 사용 가능이 아니다.`
    : unverified > 0
    ? `\n미확인 ${unverified}건: Ubuntu 설치에서 다시 확인하기 전에는 Linux 배포를 사용 가능으로 표시하지 않는다.`
    : "\n모든 항목 통과: 이 설치는 확인됐다(앱 호출·backup restore는 flow install-lophn E2E가 따로 본다).",
);
Deno.exit(failed > 0 ? 1 : unverified > 0 ? 2 : 0);
