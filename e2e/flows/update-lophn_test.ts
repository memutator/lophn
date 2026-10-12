// flow update-lophn 1·2·3·4·5·6·7·8단계(docs/flows/update-lophn.md). 실제 ~/.lophn은 열지 않는다.
// 1·2단계는 실제 shell(headless)과 core를 임시 LOPHN_HOME으로 띄운다.
// 1단계: settings에서 이 OS의 설치 패키지를 확인하고 사람이 고른 로컬 metadata로 수동 update를
// 고른다. 자동 다운로드·자동 설치·사용 중 재시작은 없고, 검증하지 않은 배포를 사용 가능한
// 완료로 안내하지 않는다.
// 2단계: 정상 정지 뒤 그 패키지 파일로 설치 파일만 바꾼다. 데이터 폴더의 ledger는 남는다.
// 3단계: schema가 뒤처져 있으면 화면 없이 제품 core만 다시 띄운다. 새 command는 migration이
// 끝나기 전에 받지 않고, 이미 끝난 짧은 쓰기와 데이터 폴더는 남긴다. 검증 backup 뒤에
// 포함된 단계를 순서대로 적용하고, 실패한 단계는 rollback한 뒤 다음 기동이 그 단계부터
// 다시 한다.
// 4단계: 화면 없이 제품 core만 다시 띄운다. 설정·무결성·기존 고정 판과 참조·실행 자격·
// 중단 작업을 확인한다. 모르는 schema나 손상 원본은 자동 초기화하거나 downgrade하지 않고
// 보존한다. 검증 backup·단계 rollback·이력 hash 불일치는 3단계가 본다.
// 5단계: 화면 없이 제품 core(apps 팀)를 temp home으로 띄운다. update가 새 SDK version만 더하고,
// 기존 앱의 release가 고정한 SDK 의존과 bundle 사본은 그대로이며 앱 activation 결정은 없다.
// 6단계: 화면 없이 제품 core(lophn-agent 팀)를 temp home으로 띄운다. update가 agent runtime을
// 중단 지점에 멈추고 같은 데이터 root로 core를 다시 띄운 뒤, 새 runtime이 끊긴 일을 저장된
// 경계에서 복구한다. 완전 응답·확정 결과와 결과를 모르는 쓰기는 반복하지 않는다. provider는
// fake provider다.
// 7단계: 실제 shell(headless)과 core를 임시 LOPHN_HOME으로 띄워 프로젝트 탭(문서 둘·터미널)을
// 열고, settings의 정상 정지로 update를 멈춘 뒤 같은 홈으로 shell을 다시 띄운다. 탭 순서·선택 탭·
// 문서 읽던 위치를 이어 쓰고, 터미널은 종료된 자리표시로 남아 사람이 새로 시작하기 전에는 명령을
// 다시 실행하지 않는다.
// 8단계: 같은 흐름으로 update를 멈추고 같은 홈으로 shell을 다시 띄운 뒤, 사람 token의 health read가
// 구성 요소별 현재 가용성과 읽는 시각의 관측 시각을 주는지, 중단된 앱 invocation이 성공으로
// 채워지지 않고 확인 불가로 남는지, update 화면이 재기동만으로 완료·검증을 주장하지 않는지 본다.
import { assert, assertEquals, assertThrows } from "@std/assert";
import { type ChildProcess, spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

import { err, ok, type Result, sha256Hex } from "../../packages/base/mod.ts";
import { canonicalJson } from "../../packages/core/apps/blueprint/mod.ts";
import type { Blueprint } from "../../packages/core/apps/blueprint/mod.ts";
import {
  bundleCopyPath,
  sealBundle,
} from "../../packages/core/apps/releases/mod.ts";
import { installPackage } from "../../packages/core/apps/packages/mod.ts";
import { removeTree } from "../../packages/core/apps/packages/testing/mod.ts";
import { createLedgerRegistration as createAppsRegistration } from "../../packages/core/apps/register.ts";
import { type Core, startCore } from "../../packages/core/main/daemon/core.ts";
import {
  APP,
  RELEASE_ID,
  seedLedger,
} from "../../packages/core/testing/app-export-fixtures.ts";
import {
  encodeFrame,
  FrameDecoder,
  type MainHello,
  mainHelloSchema,
  mainToCoreMessageSchema,
} from "../../packages/protocol/server/mod.ts";
import { RECOVERY_STAMP } from "../../packages/core/storage/migration/mod.ts";
import { SECRET_SCHEMA_STEPS } from "../../packages/core/secrets/mod.ts";
import { SETTINGS_SCHEMA_STEPS } from "../../packages/core/config/mod.ts";
import { coreLaunch } from "../../packages/shell/main/desktop/core/supervise.ts";
import type { Script } from "../../tools/fake-provider/mod.ts";
import type { ToolLookup } from "../../packages/core/lophn-agent/waiting-and-recovery/mod.ts";
import { decide as humanDecide } from "../../packages/core/testing/approvals-fixture.ts";
import {
  count,
  inspect,
  openRecoveryWorld,
  type RecoveryWorld,
  USER_TOKEN,
} from "../../packages/core/testing/run-recovery-world.ts";
import { e2eEnabled } from "../harness.ts";
import {
  documentTitled,
  type FlowShell,
  mustCall,
  openFlowShell,
  PROJECT as WORKSPACE_PROJECT,
  registerTrackedProject,
  removeHome,
  untilDocuments,
} from "../flow-support.ts";

const OFFERED = "0.9.0";
const UNVERIFIED =
  "Updates on your system aren't checked by lophn yet. Check the file before applying it.";

function formatOf(os: string): string {
  if (os === "linux") return "deb";
  if (os === "darwin") return "dmg";
  if (os === "windows") return "exe";
  throw new Error(`이 테스트가 모르는 OS다: ${os}`);
}

async function openUpdate(flow: FlowShell): Promise<void> {
  await flow.until(
    `document.querySelector("[data-screen-body='settings']") !== null`,
    "settings가 서지 않았다",
  );
  await flow.until(
    `[...document.querySelectorAll("[role=tab]")].some((el) => el.textContent.trim() === "Update lophn")`,
    "settings에 Update 탭이 없다",
  );
  await flow.mouseClickText("[role=tab]", "Update lophn");
  await flow.until(
    `document.querySelector("[data-update]") !== null`,
    "update 자리가 열리지 않았다",
  );
}

async function platformStatus(flow: FlowShell): Promise<{
  schema: number;
  ledgerId: string;
}> {
  const status = await mustCall(flow, {
    kind: "read",
    resource: "platform",
    method: "status",
    body: {},
  });
  const schema = status.schema;
  const ledgerId = status.ledger_id;
  assert(typeof schema === "number" && Number.isInteger(schema) && schema > 0);
  assert(typeof ledgerId === "string" && ledgerId !== "");
  assertEquals(status.ready, true);
  return { schema, ledgerId };
}

Deno.test({
  name:
    "platform/install-and-update#R1 platform/install-and-update#R13 flow update-lophn 1: settings에서 이 OS의 설치 패키지를 확인하고 수동 update를 고른다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const os = Deno.build.os;
    const format = formatOf(os);
    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-update-" });
    await Deno.chmod(home, 0o700);
    const pack = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-e2e-update-pkg-" }),
    );
    const metadata = `${pack}/lophn-update.json`;
    let opened: FlowShell | undefined;
    try {
      const flow = await openFlowShell({
        home,
        start: "settings",
        pickFolder: metadata,
      });
      opened = flow;
      await openUpdate(flow);
      assertEquals(
        (await flow.text("[data-package='none']"))?.trim(),
        "No update file is chosen yet.",
      );
      assertEquals((await flow.text("[data-deployment]"))?.trim(), UNVERIFIED);
      assertEquals(await flow.count("[data-action='choose-package']"), 1);
      assertEquals(await flow.count("[data-action='stop-and-update']"), 0);
      assertEquals(await flow.count("[data-notice='ready']"), 0);
      const beforeChoose = String(await flow.text("[data-update]"));
      assert(
        beforeChoose.includes(
          "You choose when to update. lophn doesn't download or restart by itself.",
        ),
      );
      assert(!beforeChoose.includes("Download"));
      const before = await platformStatus(flow);
      const body = JSON.stringify({
        version: OFFERED,
        os,
        format,
        schema: before.schema,
      });
      await Deno.writeTextFile(metadata, body);
      await flow.click("[data-action='choose-package']");
      await flow.until(
        `document.querySelector("[data-notice='ready']") !== null`,
        "수동 update 안내가 오지 않았다",
      );
      const version = (await flow.text("[data-update-version]"))?.trim() ?? "";
      const prefix =
        `Update file is version ${OFFERED} for ${os}. This version is `;
      assert(version.startsWith(prefix), version);
      const current = version.slice(prefix.length).replace(/\.$/, "");
      assert(current !== "" && current !== OFFERED, version);
      assertEquals(
        (await flow.text("[data-update-schema]"))?.trim(),
        "Your records keep working with this update.",
      );
      assertEquals(
        (await flow.text("[data-update-restart]"))?.trim(),
        "lophn stops cleanly before the update and you start it again.",
      );
      assertEquals((await flow.text("[data-deployment]"))?.trim(), UNVERIFIED);
      const afterChoose = String(await flow.text("[data-update]"));
      assert(!afterChoose.includes("Download"));
      assert(!afterChoose.includes("verified"));
      assertEquals(await flow.count("[data-stop]"), 0);
      assertEquals(await Deno.readTextFile(metadata), body);
      const after = await platformStatus(flow);
      assertEquals(after.ledgerId, before.ledgerId);
      assertEquals(after.schema, before.schema);
      assert((await Deno.stat(`${home}/lophn.db`)).isFile);
    } finally {
      await opened?.close();
      await removeHome(home);
      await Deno.remove(pack, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "platform/install-and-update#R14 platform/ledger#R21 flow update-lophn 2: 정상 정지 뒤 사람이 고른 패키지 파일로 설치 파일만 바꾸고 ledger는 남긴다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const os = Deno.build.os;
    const format = formatOf(os);
    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-update-" });
    await Deno.chmod(home, 0o700);
    const pack = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-e2e-update-pkg-" }),
    );
    const install = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-e2e-update-install-" }),
    );
    const metadata = `${pack}/lophn-update.json`;
    await Deno.writeTextFile(`${install}/lophn-update.json`, "old-install\n");
    await Deno.writeTextFile(`${install}/untouched.txt`, "keep\n");
    let opened: FlowShell | undefined;
    try {
      const flow = await openFlowShell({
        home,
        start: "settings",
        pickFolder: metadata,
        env: { LOPHN_INSTALL_ROOT: install },
      });
      opened = flow;
      await openUpdate(flow);
      const before = await platformStatus(flow);
      const body = JSON.stringify({
        version: OFFERED,
        os,
        format,
        schema: before.schema,
      });
      await Deno.writeTextFile(metadata, body);
      await Deno.writeTextFile(`${home}/kept.txt`, "kept\n");
      await flow.click("[data-action='choose-package']");
      await flow.until(
        `document.querySelector("[data-notice='ready']") !== null`,
        "수동 update 안내가 오지 않았다",
      );
      assertEquals(await flow.count("[data-action='stop-and-update']"), 1);
      const shown = String(await flow.text("[data-update]"));
      assert(!shown.includes("Download"));
      await flow.click("[data-action='stop-and-update']");
      await flow.until(
        `document.querySelector("[data-stop='stopped'], [data-stop='failed']") !== null`,
        "정상 정지가 끝나지 않았다",
        90_000,
      );
      assertEquals(
        (await flow.text("[data-stop='stopped']"))?.trim(),
        "lophn stopped cleanly. Start lophn again.",
      );
      assertEquals((await flow.text("[data-deployment]"))?.trim(), UNVERIFIED);
      assert(!String(await flow.text("[data-update]")).includes("Download"));
      let coreGone = false;
      try {
        const reply = await flow.call({
          kind: "read",
          resource: "platform",
          method: "status",
          body: {},
        });
        coreGone = !reply.ok;
      } catch {
        coreGone = true;
      }
      assert(coreGone, "플랫폼이 아직 응답한다");
      assertEquals(
        await Deno.readTextFile(`${install}/lophn-update.json`),
        body,
      );
      assertEquals(
        await Deno.readTextFile(`${install}/untouched.txt`),
        "keep\n",
      );
      assertEquals(await Deno.readTextFile(metadata), body);
      assertEquals(
        (await Deno.readTextFile(`${home}/ledger-id`)).trim(),
        before.ledgerId,
      );
      const ledger = await Deno.stat(`${home}/lophn.db`);
      assert(ledger.isFile && ledger.size > 0);
      assertEquals(await Deno.readTextFile(`${home}/kept.txt`), "kept\n");
    } finally {
      await opened?.close();
      await removeHome(home);
      await Deno.remove(pack, { recursive: true });
      await Deno.remove(install, { recursive: true });
    }
  },
});

// 3단계는 화면이 없다. 제품 core(main.ts)만 띄운다. 마지막 두 설치 step을 걷어
// 옛 schema로 만들고, 그 중 앞 단계가 중간에 실패하게 심어 둔다.
const UPDATE_REPO = new URL("../../", import.meta.url).pathname.replace(
  /\/$/,
  "",
);
const BOOT_MS = 180_000;
const KEPT_PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const AFTER_PROJECT = "prj_01arz3ndektsv4rrffq69g5faw";
const NO_DELETE = `
create trigger if not exists schema_migrations_no_delete
before delete on schema_migrations
begin
  select raise(abort, 'immutable');
end`;

type MigrationRow = {
  version: number;
  stepId: string;
  contentHash: string;
  appliedAt: string;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function freePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

function readHistory(home: string): MigrationRow[] {
  const db = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
  try {
    return db.prepare(
      "select version, step_id, content_hash, applied_at from schema_migrations order by version",
    ).all().map((row) => ({
      version: Number(row["version"]),
      stepId: String(row["step_id"]),
      contentHash: String(row["content_hash"]),
      appliedAt: String(row["applied_at"]),
    }));
  } finally {
    db.close();
  }
}

function tableExists(home: string, name: string): boolean {
  const db = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
  try {
    return db.prepare(
      "select 1 as present from sqlite_master where type = 'table' and name = ?",
    ).get(name) !== undefined;
  } finally {
    db.close();
  }
}

function countOf(home: string, table: string): number {
  const db = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
  try {
    return Number(
      db.prepare(`select count(*) as n from ${table}`).get()?.["n"],
    );
  } finally {
    db.close();
  }
}

function projectTitle(home: string, id: string): string | undefined {
  const db = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
  try {
    const row = db.prepare("select title from projects where id = ?").get(id);
    return row === undefined ? undefined : String(row["title"]);
  } finally {
    db.close();
  }
}

function integrityOf(path: string): string {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return String(
      db.prepare("pragma integrity_check").get()?.["integrity_check"],
    );
  } finally {
    db.close();
  }
}

function writeLedger(home: string, change: (db: DatabaseSync) => void): void {
  const db = new DatabaseSync(`${home}/lophn.db`);
  try {
    change(db);
    db.exec("pragma wal_checkpoint(full)");
  } finally {
    db.close();
  }
}

async function recoveryFolders(home: string): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(`${home}/backups/migrations`)) {
    if (entry.isDirectory) names.push(entry.name);
  }
  names.sort();
  return names;
}

function childPids(pid: number | undefined): number[] {
  if (pid === undefined) return [];
  try {
    return Deno.readTextFileSync(`/proc/${pid}/task/${pid}/children`).trim()
      .split(/\s+/).filter((part) => part !== "").map(Number);
  } catch {
    return [];
  }
}

function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  for (const child of childPids(pid)) killTree(child);
  try {
    Deno.kill(pid, "SIGKILL");
  } catch { /* 이미 끝남 */ }
}

function describePid(pid: number): string {
  try {
    return Deno.readTextFileSync(`/proc/${pid}/cmdline`).replaceAll("\0", " ")
      .trim();
  } catch {
    return "gone";
  }
}

async function httpUp(port: number): Promise<boolean> {
  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/v1/platform/status`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(200),
      },
    );
    await response.body?.cancel();
    return true;
  } catch {
    return false;
  }
}

function exitCode(child: ChildProcess, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("exit", onExit);
      // 신호로 죽은 프로세스를 정상 종료(0)로 세지 않는다.
      resolve(signal !== null || code === null ? 128 : code);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      finish(code, signal);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.off("exit", onExit);
      reject(new Error("core가 끝나지 않았다"));
    }, timeoutMs);
    child.on("exit", onExit);
    if (child.exitCode !== null || child.signalCode !== null) {
      finish(child.exitCode, child.signalCode);
    }
  });
}

function readHello(child: ChildProcess, timeoutMs: number): Promise<MainHello> {
  const decoder = new FrameDecoder();
  return new Promise((resolve, reject) => {
    let settled = false;
    const stdout = child.stdout;
    const finish = (error?: Error, hello?: MainHello) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stdout?.off("data", onData);
      child.off("exit", onExit);
      if (hello !== undefined) resolve(hello);
      else reject(error ?? new Error("core가 hello 전에 끝났다"));
    };
    const timer = setTimeout(
      () => finish(new Error("core hello가 오지 않았다")),
      timeoutMs,
    );
    const onData = (chunk: Uint8Array) => {
      let frames;
      try {
        frames = decoder.push(new Uint8Array(chunk));
      } catch (error) {
        finish(error instanceof Error ? error : new Error("frame"));
        return;
      }
      for (const frame of frames) {
        if (frame.kind !== "json") continue;
        const parsed = mainHelloSchema.safeParse(frame.payload);
        if (parsed.success) finish(undefined, parsed.data);
      }
    };
    const onExit = () => finish(new Error("core가 hello 전에 끝났다"));
    if (stdout === null) {
      finish(new Error("core stdout이 없다"));
      return;
    }
    stdout.on("data", onData);
    child.on("exit", onExit);
    if (child.exitCode !== null || child.signalCode !== null) onExit();
  });
}

type Boot = {
  child: ChildProcess;
  port: number;
  hello: Promise<MainHello>;
  finished: Promise<number>;
  sawHttp: () => boolean;
  children: () => string[];
  stop: () => Promise<number>;
};

function bootCore(
  home: string,
  sessionHome: string,
  env: Record<string, string> = {},
): Boot {
  const port = freePort();
  const launch = coreLaunch({
    repoRoot: UPDATE_REPO,
    dataRoot: home,
    denoBinary: Deno.execPath(),
    packaged: false,
    port,
    env: { HOME: sessionHome, ...env },
  });
  const child = spawn(launch.command, [...launch.args], {
    cwd: UPDATE_REPO,
    env: launch.env,
    stdio: ["pipe", "pipe", "inherit"],
  });
  const hello = readHello(child, BOOT_MS);
  void hello.catch(() => {});
  let saw = false;
  const seen = new Set<number>();
  let closed = false;
  const watch = (async () => {
    while (!closed && child.exitCode === null && child.signalCode === null) {
      if (await httpUp(port)) saw = true;
      for (const pid of childPids(child.pid)) seen.add(pid);
      await delay(50);
    }
  })();
  const finished = exitCode(child, BOOT_MS);
  void finished.catch(() => {});
  return {
    child,
    port,
    hello,
    finished,
    sawHttp: () => saw,
    children: () => [...seen].map(describePid),
    async stop() {
      closed = true;
      await watch.catch(() => {});
      if (child.exitCode !== null) return child.exitCode;
      if (child.signalCode !== null) return 128;
      const message = mainToCoreMessageSchema.parse({
        type: "stop",
        grace_ms: 5_000,
      });
      try {
        child.stdin?.write(
          encodeFrame({ kind: "json", channel: 0, payload: message }),
        );
      } catch { /* pipe가 이미 닫힘 */ }
      try {
        return await exitCode(child, 20_000);
      } catch {
        killTree(child.pid);
        return await exitCode(child, 5_000);
      }
    },
  };
}

async function post(hello: MainHello, path: string, body: unknown) {
  const response = await fetch(
    `http://127.0.0.1:${hello.api_port}/v1/${path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${hello.user_token}`,
      },
      body: JSON.stringify(body),
    },
  );
  const text = await response.text();
  return {
    status: response.status,
    body: text === "" ? {} : JSON.parse(text) as Record<string, unknown>,
  };
}

function projectBody(id: string, name: string, key: string) {
  return {
    input: {
      id,
      name,
      title: name,
      purpose: "",
      folders: [],
      tracking: { enabled: false, patterns: [], use_gitignore: false },
    },
    idempotency_key: key,
    compare: {},
    prepared: [],
  };
}

async function assertRefused(boot: Boot): Promise<void> {
  const outcome = await Promise.race([
    boot.hello.then(() => "hello" as const, () => "ended" as const),
    boot.finished.then(() => "ended" as const, () => "ended" as const),
  ]);
  assertEquals(outcome, "ended");
  const code = await boot.finished;
  assert(code !== 0, "schema를 거절했는데 core가 정상으로 끝났다");
  assertEquals(
    boot.sawHttp(),
    false,
    "migration 중에 새 command 입구가 열려 있다",
  );
  assertEquals(
    boot.children(),
    [],
    `migration 중에 worker가 떠 있다: ${boot.children().join(" | ")}`,
  );
}

Deno.test({
  name:
    "platform/backup-and-migration#R1 platform/backup-and-migration#R2 platform/backup-and-migration#R3 platform/backup-and-migration#R4 flow update-lophn 3: schema가 필요하면 검증 backup 뒤에 단계를 적용하고 실패한 단계는 직전 schema로 남긴다",
  ignore: Deno.env.get("LOPHN_E2E") !== "1",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const root = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-e2e-update-schema-" }),
    );
    const home = `${root}/data`;
    const sessionHome = `${root}/session`;
    await Deno.mkdir(home, { mode: 0o700 });
    await Deno.chmod(home, 0o700);
    await Deno.mkdir(sessionHome, { mode: 0o700 });
    let running: Boot | undefined;
    const halt = async () => {
      const current = running;
      running = undefined;
      if (current !== undefined) {
        killTree(current.child.pid);
        await current.finished.catch(() => {});
      }
    };
    try {
      const first = bootCore(home, sessionHome);
      running = first;
      const hello = await first.hello;
      assertEquals(hello.api_port, first.port);
      const created = await post(
        hello,
        "projects/create",
        projectBody(KEPT_PROJECT, "kept", "update-lophn-kept-write"),
      );
      assertEquals(created.status, 200, JSON.stringify(created.body));
      const ledgerId = (await Deno.readTextFile(`${home}/ledger-id`)).trim();
      assert(ledgerId !== "");
      const commandsBefore = countOf(home, "command_results");
      assert(commandsBefore >= 1);
      assertEquals(
        await first.stop(),
        0,
        "짧은 쓰기를 끝내는 정상 정지가 아니다",
      );
      running = undefined;
      await Deno.writeTextFile(`${home}/kept.txt`, "kept\n");
      const installed = readHistory(home);
      assert(installed.length >= 2, "설치 schema가 너무 짧다");
      const settingsStep = SETTINGS_SCHEMA_STEPS[0];
      const secretsStep = SECRET_SCHEMA_STEPS[0];
      assertEquals(
        installed.slice(-2).map((row) => row.stepId),
        [settingsStep.id, secretsStep.id],
      );
      const prior = installed.length - 2;
      writeLedger(home, (db) => {
        assertThrows(() => db.exec("delete from schema_migrations"));
        assertThrows(
          () => db.exec("update schema_migrations set applied_at = applied_at"),
        );
        db.exec("drop trigger schema_migrations_no_delete");
        db.prepare("delete from schema_migrations where version > ?").run(
          prior,
        );
        db.exec(NO_DELETE);
        db.exec("drop table if exists secret_preparations");
        db.exec("drop table if exists secrets");
        db.exec("drop table if exists settings_state");
        db.exec("drop table if exists setting_revisions");
        db.exec("drop table if exists setting_choices");
        // 실패는 단계 중간이다. 앞의 create는 transaction 안에서 rollback되어야 한다.
        db.exec("create table settings_state (key integer primary key)");
      });
      assertEquals(readHistory(home).length, prior);
      assertEquals(tableExists(home, "setting_choices"), false);
      assertEquals(tableExists(home, "settings_state"), true);
      assertEquals(tableExists(home, "secrets"), false);
      assertEquals(projectTitle(home, KEPT_PROJECT), "kept");

      const failed = bootCore(home, sessionHome);
      running = failed;
      await assertRefused(failed);
      await failed.stop();
      running = undefined;
      assertEquals(readHistory(home).length, prior);
      assertEquals(
        readHistory(home).some((row) => row.stepId === settingsStep.id),
        false,
      );
      assertEquals(tableExists(home, "setting_choices"), false);
      assertEquals(tableExists(home, "setting_revisions"), false);
      assertEquals(tableExists(home, "settings_state"), true);
      assertEquals(tableExists(home, "secrets"), false);
      assertEquals(tableExists(home, "secret_preparations"), false);
      assertEquals(countOf(home, "command_results"), commandsBefore);
      assertEquals(projectTitle(home, KEPT_PROJECT), "kept");
      assertEquals(await Deno.readTextFile(`${home}/kept.txt`), "kept\n");
      assertEquals(
        (await Deno.readTextFile(`${home}/ledger-id`)).trim(),
        ledgerId,
      );
      const failedBackups = await recoveryFolders(home);
      assertEquals(failedBackups.length, 1);
      assert(
        failedBackups[0].startsWith(`s${prior}-`) &&
          RECOVERY_STAMP.test(failedBackups[0].slice(`s${prior}-`.length)),
        failedBackups[0],
      );
      const failedCopy = `${home}/backups/migrations/${
        failedBackups[0]
      }/ledger.db`;
      assertEquals(integrityOf(failedCopy), "ok");
      const copyDb = new DatabaseSync(failedCopy, { readOnly: true });
      try {
        assertEquals(
          Number(
            copyDb.prepare("select count(*) as n from schema_migrations").get()
              ?.["n"],
          ),
          prior,
        );
        assertEquals(
          copyDb.prepare("select title from projects where id = ?").get(
            KEPT_PROJECT,
          )?.["title"],
          "kept",
        );
        assertEquals(
          copyDb.prepare(
            "select name from sqlite_master where name = 'setting_choices'",
          ).get(),
          undefined,
        );
      } finally {
        copyDb.close();
      }

      await Deno.rename(
        `${home}/backups/migrations`,
        `${home}/backups/migrations-kept`,
      );
      await Deno.writeTextFile(
        `${home}/backups/migrations`,
        "not a directory\n",
      );
      const blocked = bootCore(home, sessionHome);
      running = blocked;
      await assertRefused(blocked);
      await blocked.stop();
      running = undefined;
      assertEquals(readHistory(home).length, prior);
      assertEquals(tableExists(home, "setting_choices"), false);
      assertEquals(countOf(home, "command_results"), commandsBefore);
      assertEquals(projectTitle(home, KEPT_PROJECT), "kept");
      assertEquals(await Deno.readTextFile(`${home}/kept.txt`), "kept\n");
      await Deno.remove(`${home}/backups/migrations`);
      await Deno.rename(
        `${home}/backups/migrations-kept`,
        `${home}/backups/migrations`,
      );
      assertEquals(await recoveryFolders(home), failedBackups);

      writeLedger(home, (db) => {
        db.exec("drop table settings_state");
      });
      const settingsHash = await sha256Hex(settingsStep.sql);
      const secretsHash = await sha256Hex(secretsStep.sql);
      const again = bootCore(home, sessionHome);
      running = again;
      const restarted = await again.hello;
      assertEquals(restarted.api_port, again.port);
      const status = await post(restarted, "platform/status", {});
      assertEquals(status.status, 200, JSON.stringify(status.body));
      assertEquals(status.body["ready"], true);
      assertEquals(status.body["ledger_id"], ledgerId);
      const applied = readHistory(home);
      assertEquals(applied.length, installed.length);
      assertEquals(
        applied.slice(0, prior).map((row) => row.contentHash),
        installed.slice(0, prior).map((row) => row.contentHash),
      );
      assertEquals(applied[prior], {
        version: prior + 1,
        stepId: settingsStep.id,
        contentHash: settingsHash,
        appliedAt: applied[prior].appliedAt,
      });
      assertEquals(applied[prior + 1].stepId, secretsStep.id);
      assertEquals(applied[prior + 1].contentHash, secretsHash);
      assert(applied[prior].appliedAt.includes("T"), applied[prior].appliedAt);
      assert(
        applied[prior + 1].appliedAt.includes("T"),
        applied[prior + 1].appliedAt,
      );
      assertEquals(tableExists(home, "setting_choices"), true);
      assertEquals(tableExists(home, "settings_state"), true);
      assertEquals(tableExists(home, "secrets"), true);
      assertEquals(tableExists(home, "secret_preparations"), true);
      assertEquals(projectTitle(home, KEPT_PROJECT), "kept");
      const after = await post(
        restarted,
        "projects/create",
        projectBody(AFTER_PROJECT, "after", "update-lophn-after-migration"),
      );
      assertEquals(after.status, 200, JSON.stringify(after.body));
      assert(countOf(home, "command_results") > commandsBefore);
      assertEquals(await Deno.readTextFile(`${home}/kept.txt`), "kept\n");
      assertEquals(
        (await Deno.readTextFile(`${home}/ledger-id`)).trim(),
        ledgerId,
      );
      assert((await Deno.stat(`${home}/apps`)).isDirectory);
      const doneBackups = await recoveryFolders(home);
      assertEquals(doneBackups.length, 2);
      assert(doneBackups.includes(failedBackups[0]));
      for (const name of doneBackups) {
        assert(
          name.startsWith(`s${prior}-`) &&
            RECOVERY_STAMP.test(name.slice(`s${prior}-`.length)),
          name,
        );
      }
      const second = doneBackups.find((name) => name !== failedBackups[0]);
      assert(second !== undefined);
      const secondCopy = `${home}/backups/migrations/${second}/ledger.db`;
      assertEquals(integrityOf(secondCopy), "ok");
      const secondDb = new DatabaseSync(secondCopy, { readOnly: true });
      try {
        assertEquals(
          Number(
            secondDb.prepare("select count(*) as n from schema_migrations")
              .get()?.["n"],
          ),
          prior,
        );
        assertEquals(
          secondDb.prepare(
            "select name from sqlite_master where name = 'secrets'",
          ).get(),
          undefined,
        );
        assertEquals(
          secondDb.prepare("select title from projects where id = ?").get(
            KEPT_PROJECT,
          )?.["title"],
          "kept",
        );
      } finally {
        secondDb.close();
      }
      writeLedger(home, (db) => {
        assertThrows(
          () =>
            db.exec("update schema_migrations set content_hash = content_hash"),
        );
      });
      assertEquals(await again.stop(), 0);
      running = undefined;

      writeLedger(home, (db) => {
        db.exec("drop trigger schema_migrations_no_update");
        db.prepare(
          "update schema_migrations set content_hash = ? where version = 1",
        )
          .run("a".repeat(64));
        db.exec(`
create trigger schema_migrations_no_update
before update on schema_migrations
begin
  select raise(abort, 'immutable');
end`);
      });
      const beforeTamper = await recoveryFolders(home);
      const mismatch = bootCore(home, sessionHome);
      running = mismatch;
      await assertRefused(mismatch);
      await mismatch.stop();
      running = undefined;
      assertEquals(await recoveryFolders(home), beforeTamper);
      assertEquals(readHistory(home).length, installed.length);
      assertEquals(readHistory(home)[0].contentHash, "a".repeat(64));
      assertEquals(projectTitle(home, KEPT_PROJECT), "kept");
      assertEquals(projectTitle(home, AFTER_PROJECT), "after");
      assertEquals(await Deno.readTextFile(`${home}/kept.txt`), "kept\n");
      assertEquals(
        (await Deno.readTextFile(`${home}/ledger-id`)).trim(),
        ledgerId,
      );
      assert((await Deno.stat(`${home}/lophn.db`)).isFile);
    } finally {
      await halt();
      await Deno.remove(root, { recursive: true });
    }
  },
});

// 4단계는 화면이 없다. 저장한 원문과 그 hash만 고정 판 참조로 쓴다.
const NOTE_DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const NOTE_PROJECT = "prj_01arz3ndektsv4rrffq69g5fb0";
const NOTE_TEXT = "# Kept\n\nbody\n";
const NOTE_PATH = "kept.md";
const INTERRUPTED = "inv_01arz3ndektsv4rrffq69g5fav";
const INTERRUPTED_APP = "app_01arz3ndektsv4rrffq69g5fav";
const INTERRUPTED_RELEASE = "rel_01arz3ndektsv4rrffq69g5fav";
const INTERRUPTED_AT = "2020-01-01T00:00:00.000Z";

type EventFact = {
  seq: string;
  type: string;
  subject: string | null;
  actor: string;
  payload: string;
  at: string;
};

type VersionFact = {
  id: string;
  document: string;
  number: number;
  contentHash: string;
  savedBy: string;
  filesHash: string;
  title: string;
  latest: string;
};

function blobPath(home: string, hash: string): string {
  return `${home}/blobs/sha256/${hash.slice(0, 2)}/${hash.slice(2)}`;
}

function eventsOf(home: string): EventFact[] {
  const db = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
  try {
    return db.prepare(
      "select seq, type, subject, actor, payload, at from events order by seq",
    ).all().map((row) => ({
      seq: String(row["seq"]),
      type: String(row["type"]),
      subject: row["subject"] === null ? null : String(row["subject"]),
      actor: String(row["actor"]),
      payload: String(row["payload"]),
      at: String(row["at"]),
    }));
  } finally {
    db.close();
  }
}

function versionOf(home: string, id: string): VersionFact {
  const db = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
  try {
    const row = db.prepare(
      `select v.id, v.document, v.number, v.content_hash, v.saved_by, v.files_hash,
              d.title, d.latest_version
         from versions v
         join documents d on d.id = v.document
        where d.id = ?`,
    ).get(id);
    if (row === undefined) throw new Error("고정 판이 없다");
    return {
      id: String(row["id"]),
      document: String(row["document"]),
      number: Number(row["number"]),
      contentHash: String(row["content_hash"]),
      savedBy: String(row["saved_by"]),
      filesHash: String(row["files_hash"]),
      title: String(row["title"]),
      latest: String(row["latest_version"]),
    };
  } finally {
    db.close();
  }
}

function fileRef(
  home: string,
  version: string,
): { hash: string; size: number } {
  const db = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
  try {
    const row = db.prepare(
      `select hash, size_bytes from blob_refs
        where owner_kind = 'document_version' and owner_key = ? and field = 'file'`,
    ).get(`${version}/${NOTE_PATH}`);
    if (row === undefined) throw new Error("판 파일 참조가 없다");
    return {
      hash: String(row["hash"]),
      size: Number(row["size_bytes"]),
    };
  } finally {
    db.close();
  }
}

function invocationOf(
  home: string,
): { status: string; summary: string; started: string } {
  const db = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
  try {
    const rows = db.prepare(
      "select status, summary, started_at from invocations order by id",
    ).all();
    assertEquals(rows.length, 1);
    return {
      status: String(rows[0]["status"]),
      summary: String(rows[0]["summary"]),
      started: String(rows[0]["started_at"]),
    };
  } finally {
    db.close();
  }
}

function triggerNamed(home: string, name: string): boolean {
  const db = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
  try {
    return db.prepare(
      "select 1 as present from sqlite_master where type = 'trigger' and name = ?",
    ).get(name) !== undefined;
  } finally {
    db.close();
  }
}

async function copyHome(from: string, to: string): Promise<void> {
  const copied = await new Deno.Command("cp", { args: ["-a", from, to] })
    .output();
  if (!copied.success) {
    throw new Error(new TextDecoder().decode(copied.stderr));
  }
}

function uploadInput(hash: string, size: number): string {
  return btoa(JSON.stringify({ blob_hash: hash, bytes: size })).replaceAll(
    "+",
    "-",
  ).replaceAll("/", "_").replaceAll("=", "");
}

async function untilReady(
  hello: MainHello,
  path: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  let last: { status: number; body: Record<string, unknown> } = {
    status: 503,
    body: {},
  };
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const response = await post(hello, path, body);
    last = response;
    if (response.status !== 503) return response;
    await delay(200);
  }
  return last;
}

async function uploadNote(
  hello: MainHello,
  bytes: Uint8Array,
  hash: string,
): Promise<Record<string, unknown>> {
  let last = "";
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const response = await fetch(
      `http://127.0.0.1:${hello.api_port}/v1/documents/upload`,
      {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          "x-lophn-input": uploadInput(hash, bytes.byteLength),
          authorization: `Bearer ${hello.user_token}`,
        },
        body: bytes.slice(),
        signal: AbortSignal.timeout(20_000),
      },
    );
    const text = await response.text();
    if (response.status === 200) {
      return JSON.parse(text) as Record<string, unknown>;
    }
    last = `${response.status} ${text}`;
    if (response.status !== 503) break;
    await delay(200);
  }
  throw new Error(`원문 업로드가 되지 않았다: ${last}`);
}

async function versionFile(
  hello: MainHello,
  version: string,
): Promise<{ status: number; bytes: Uint8Array }> {
  const response = await fetch(
    `http://127.0.0.1:${hello.api_port}/v1/documents/file`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${hello.user_token}`,
      },
      body: JSON.stringify({ version, path: NOTE_PATH }),
    },
  );
  return {
    status: response.status,
    bytes: new Uint8Array(await response.arrayBuffer()),
  };
}

Deno.test({
  name:
    "platform/install-and-update#R11 platform/backup-and-migration#R5 platform/backup-and-migration#R6 platform/identity#R7 flow update-lophn 4: 재시작이 설정·무결성·고정 판과 참조·실행 자격·중단 작업을 확인하고 모르는 schema와 손상 원본은 보존한다",
  ignore: Deno.env.get("LOPHN_E2E") !== "1",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const root = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-e2e-update-check-" }),
    );
    const home = `${root}/data`;
    const sessionHome = `${root}/session`;
    await Deno.mkdir(home, { mode: 0o700 });
    await Deno.chmod(home, 0o700);
    await Deno.mkdir(sessionHome, { mode: 0o700 });
    // 세션 HOME에는 deno cache가 없다. documents worker는 --cached-only라
    // 테스트 프로세스가 쓰는 cache를 DENO_DIR로 가리킨다.
    const cacheDir = Deno.env.get("DENO_DIR") ??
      `${Deno.env.get("HOME") ?? "/tmp"}/.cache/deno`;
    const boot = (data: string) =>
      bootCore(data, sessionHome, { DENO_DIR: cacheDir });
    const note = new TextEncoder().encode(NOTE_TEXT);
    const noteHash = await sha256Hex(note);
    let running: Boot | undefined;
    const halt = async () => {
      const current = running;
      running = undefined;
      if (current !== undefined) {
        killTree(current.child.pid);
        await current.finished.catch(() => {});
      }
    };
    try {
      const first = boot(home);
      running = first;
      const hello = await first.hello;
      const created = await post(
        hello,
        "projects/create",
        projectBody(NOTE_PROJECT, "kept", "update-lophn-4-project"),
      );
      assertEquals(created.status, 200, JSON.stringify(created.body));
      const settings = await post(hello, "settings/get", {
        keys: ["shell.reading_width"],
      });
      assertEquals(settings.status, 200, JSON.stringify(settings.body));
      const applied = await post(hello, "settings/apply", {
        input: {
          changes: [{
            layer: "common",
            key: "shell.reading_width",
            action: "set",
            value: "wide",
          }],
        },
        idempotency_key: "update-lophn-4-width",
        compare: {
          revision: settings.body["revision"],
          defaults_revision: settings.body["defaults_revision"],
        },
        prepared: [],
      });
      assertEquals(applied.status, 200, JSON.stringify(applied.body));
      const uploaded = await uploadNote(hello, note, noteHash);
      assertEquals(uploaded["hash"], noteHash);
      assertEquals(uploaded["purpose"], "document_file");
      const prepared = await untilReady(hello, "documents/prepare", {
        document: NOTE_DOC,
        base_version: null,
        metadata: { title: "Kept note", place: null, name: null },
        files: [{
          path: NOTE_PATH,
          blob_hash: noteHash,
          bytes: note.byteLength,
          media_type: "text/markdown",
          primary: true,
          content: { kind: "prepared", blob: uploaded },
        }],
        source: null,
        idempotency_key: "update-lophn-4-prepare",
      });
      assertEquals(prepared.status, 200, JSON.stringify(prepared.body));
      const preparedFiles = prepared.body["files"] as {
        preparation_ref: string;
      }[];
      const saved = await post(hello, "documents/save", {
        input: prepared.body,
        idempotency_key: "update-lophn-4-prepare",
        compare: { base_version: null },
        prepared: [
          String(prepared.body["preparation_ref"]),
          ...preparedFiles.map((file) => file.preparation_ref),
        ],
      });
      assertEquals(saved.status, 200, JSON.stringify(saved.body));
      const versionId = String(saved.body["version"]);
      const fixed = versionOf(home, NOTE_DOC);
      assertEquals(fixed.id, versionId);
      assertEquals(fixed.document, NOTE_DOC);
      assertEquals(fixed.latest, versionId);
      assertEquals(fixed.number, 1);
      assertEquals(fixed.title, "Kept note");
      assertEquals(fixed.savedBy, "user");
      const ref = fileRef(home, versionId);
      assertEquals(ref.hash, noteHash);
      assertEquals(ref.size, note.byteLength);
      assertEquals(await Deno.readFile(blobPath(home, noteHash)), note);
      const ledgerId = (await Deno.readTextFile(`${home}/ledger-id`)).trim();
      const history = readHistory(home);
      const facts = eventsOf(home);
      assert(
        facts.some((row) => row.subject === NOTE_DOC && row.actor === "user"),
      );
      const status = await post(hello, "platform/status", {});
      assertEquals(status.status, 200, JSON.stringify(status.body));
      assertEquals(status.body["ready"], true);
      const reportedSchema = status.body["schema"];
      assert(typeof reportedSchema === "number" && reportedSchema > 0);
      assert(reportedSchema <= history.length);
      assertEquals(integrityOf(`${home}/lophn.db`), "ok");

      const second = boot(home);
      await assertRefused(second);
      await second.stop();
      const still = await post(hello, "documents/get", { document: NOTE_DOC });
      assertEquals(still.status, 200, JSON.stringify(still.body));
      assertEquals(await first.stop(), 0);
      running = undefined;

      writeLedger(home, (db) => {
        db.exec("pragma foreign_keys = on");
        assertThrows(() => db.exec("update events set payload = payload"));
        assertThrows(() => db.exec("delete from events"));
        assertThrows(() =>
          db.exec("update schema_migrations set content_hash = content_hash")
        );
        const command = db.prepare(
          "select principal, idempotency_key, fingerprint, result, first_seq, last_seq, at from command_results limit 1",
        ).get();
        assert(command !== undefined);
        assertThrows(() =>
          db.prepare(
            "insert into command_results (principal, idempotency_key, fingerprint, result, first_seq, last_seq, at) values (?, ?, ?, ?, ?, ?, ?)",
          ).run(
            command["principal"],
            command["idempotency_key"],
            command["fingerprint"],
            command["result"],
            command["first_seq"],
            command["last_seq"],
            command["at"],
          )
        );
        assertThrows(() =>
          db.prepare(
            "insert into blob_refs (owner_kind, owner_key, field, hash, size_bytes, registered_seq) values ('document_version', 'missing', 'file', ?, ?, 999999999)",
          ).run(noteHash, note.byteLength)
        );
      });
      writeLedger(home, (db) => {
        db.prepare(
          `insert into invocations (
             id, app, release, mode, actor, caller, operation, trigger,
             approval, input_hash, status, started_at, finished_at, summary, detail_hash
           ) values (?, ?, ?, 'live', 'user', ?, ?, ?, null, null, 'running', ?, null, '{}', null)`,
        ).run(
          INTERRUPTED,
          INTERRUPTED_APP,
          INTERRUPTED_RELEASE,
          JSON.stringify({ kind: "direct" }),
          JSON.stringify({ kind: "command", command: "usage.sync" }),
          JSON.stringify({ kind: "direct" }),
          INTERRUPTED_AT,
        );
      });
      await Deno.writeTextFile(`${home}/kept.txt`, "kept\n");

      const again = boot(home);
      running = again;
      const restarted = await again.hello;
      assert(restarted.user_token !== hello.user_token);
      assert(restarted.core_epoch !== hello.core_epoch);
      const stale = await post(
        { ...restarted, user_token: hello.user_token },
        "documents/get",
        { document: NOTE_DOC },
      );
      assertEquals(stale.status, 401);
      const read = await post(restarted, "documents/get", {
        document: NOTE_DOC,
      });
      assertEquals(read.status, 200, JSON.stringify(read.body));
      const readVersion = read.body["version"] as {
        id: string;
        document: string;
        number: number;
        content_hash: string;
        saved_by: string;
        files: { path: string; blob_hash: string; bytes: number }[];
      };
      assertEquals(readVersion.id, fixed.id);
      assertEquals(readVersion.document, fixed.document);
      assertEquals(readVersion.number, fixed.number);
      assertEquals(readVersion.content_hash, fixed.contentHash);
      assertEquals(readVersion.saved_by, fixed.savedBy);
      assertEquals(readVersion.files[0].path, NOTE_PATH);
      assertEquals(readVersion.files[0].blob_hash, noteHash);
      assertEquals(readVersion.files[0].bytes, note.byteLength);
      const readDocument = read.body["document"] as {
        id: string;
        title: string;
        latest_version: string;
      };
      assertEquals(readDocument.id, NOTE_DOC);
      assertEquals(readDocument.title, "Kept note");
      assertEquals(readDocument.latest_version, versionId);
      const file = await versionFile(restarted, versionId);
      assertEquals(
        file.status,
        200,
        new TextDecoder().decode(file.bytes),
      );
      assertEquals(file.bytes, note);
      const width = await post(restarted, "settings/get", {
        keys: ["shell.reading_width"],
      });
      assertEquals(width.status, 200, JSON.stringify(width.body));
      const chosen = (width.body["settings"] as {
        key: string;
        value: unknown;
      }[]).find((row) => row.key === "shell.reading_width");
      assertEquals(chosen?.value, "wide");
      const restartedStatus = await post(restarted, "platform/status", {});
      assertEquals(
        restartedStatus.status,
        200,
        JSON.stringify(restartedStatus.body),
      );
      assertEquals(restartedStatus.body["ready"], true);
      assertEquals(restartedStatus.body["ledger_id"], ledgerId);
      assertEquals(restartedStatus.body["schema"], reportedSchema);
      assertEquals(integrityOf(`${home}/lophn.db`), "ok");
      assertEquals(readHistory(home), history);
      assertEquals(versionOf(home, NOTE_DOC), fixed);
      assertEquals(fileRef(home, versionId), ref);
      assertEquals(await Deno.readFile(blobPath(home, noteHash)), note);
      const afterFacts = eventsOf(home);
      assertEquals(afterFacts.slice(0, facts.length), facts);
      const interrupted = invocationOf(home);
      assertEquals(interrupted.status, "unknown");
      assertEquals(interrupted.started, INTERRUPTED_AT);
      assertEquals(
        (JSON.parse(interrupted.summary) as { reason?: string }).reason,
        "core_restarted",
      );
      assertEquals(await Deno.readTextFile(`${home}/kept.txt`), "kept\n");
      assertEquals(projectTitle(home, NOTE_PROJECT), "kept");
      assertEquals(await again.stop(), 0);
      running = undefined;

      const unknown = `${root}/unknown`;
      await copyHome(home, unknown);
      const unknownHistory = readHistory(unknown);
      const futureHash = await sha256Hex("update-lophn-4-future-step");
      writeLedger(unknown, (db) => {
        db.prepare(
          "insert into schema_migrations (version, step_id, content_hash, applied_at) values (?, 'future-step', ?, ?)",
        ).run(
          unknownHistory[unknownHistory.length - 1].version + 1,
          futureHash,
          "2026-10-09T00:00:00.000Z",
        );
      });
      const unknownBefore = readHistory(unknown);
      const higher = boot(unknown);
      running = higher;
      await assertRefused(higher);
      await higher.stop();
      running = undefined;
      assertEquals(readHistory(unknown), unknownBefore);
      assertEquals(
        readHistory(unknown).slice(0, unknownHistory.length),
        unknownHistory,
      );
      assertEquals(versionOf(unknown, NOTE_DOC), fixed);
      assertEquals(await Deno.readFile(blobPath(unknown, noteHash)), note);
      assertEquals(await Deno.readTextFile(`${unknown}/kept.txt`), "kept\n");
      assertEquals(
        (await Deno.readTextFile(`${unknown}/ledger-id`)).trim(),
        ledgerId,
      );
      assertEquals(integrityOf(`${unknown}/lophn.db`), "ok");

      const damaged = `${root}/damaged`;
      await copyHome(home, damaged);
      const marker = new TextEncoder().encode(
        "damaged-original-not-a-sqlite\n",
      );
      await Deno.remove(`${damaged}/lophn.db-wal`).catch(() => {});
      await Deno.remove(`${damaged}/lophn.db-shm`).catch(() => {});
      await Deno.writeFile(`${damaged}/lophn.db`, marker);
      const broken = boot(damaged);
      running = broken;
      await assertRefused(broken);
      await broken.stop();
      running = undefined;
      assertEquals(await Deno.readFile(`${damaged}/lophn.db`), marker);
      assertEquals(await Deno.readFile(blobPath(damaged, noteHash)), note);
      assertEquals(await Deno.readTextFile(`${damaged}/kept.txt`), "kept\n");
      assertEquals(
        (await Deno.readTextFile(`${damaged}/ledger-id`)).trim(),
        ledgerId,
      );

      const unprotected = `${root}/unprotected`;
      await copyHome(home, unprotected);
      const protectedFacts = eventsOf(unprotected);
      writeLedger(unprotected, (db) => {
        db.exec("drop trigger events_no_update");
      });
      assertEquals(triggerNamed(unprotected, "events_no_update"), false);
      const open = boot(unprotected);
      running = open;
      await assertRefused(open);
      await open.stop();
      running = undefined;
      assertEquals(triggerNamed(unprotected, "events_no_update"), false);
      assertEquals(eventsOf(unprotected), protectedFacts);
      assertEquals(versionOf(unprotected, NOTE_DOC), fixed);
      assertEquals(await Deno.readFile(blobPath(unprotected, noteHash)), note);
      assertEquals(readHistory(unprotected), history);
      assertEquals(
        (await Deno.readTextFile(`${unprotected}/ledger-id`)).trim(),
        ledgerId,
      );
    } finally {
      await halt();
      await Deno.remove(root, { recursive: true });
    }
  },
});

// 5단계는 화면이 없다. 제품 core의 apps 팀(SDK catalog·release)을 temp home으로 띄운다.
// 옛 lophn이 SDK 1.0.0을 설치하고 그 판을 고정한 앱의 active release가 있다. update한 lophn은
// 새 SDK version만 더하고, 앱의 release·봉인 bundle·고정 SDK 사본·승인은 건드리지 않는다.
const SDK_NAME = "@lophn/sample";
const SDK_EXTRA = "@lophn/sample-extra";
const SDK_OLD = 'export const sdkVersion = "1.0.0";\n';
const SDK_NEW = 'export const sdkVersion = "1.1.0";\n';
const SDK_CHANGED = 'export const sdkVersion = "1.0.0-changed";\n';
const SDK_EXTRA_MOD = "export const extra = true;\n";
const GUIDE_TEXT = (version: string) => `# ${SDK_NAME}\n\n${version}\n`;
const APP_SDK_MODULE = "@lophn/sample/my-sdk";

async function bootApps(home: string): Promise<Core> {
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [{ createLedgerRegistration: createAppsRegistration }],
    teamModules: [
      new URL("../../packages/core/apps/register.ts", import.meta.url).href,
    ],
    writerClock: "system",
    testCredentials: true,
  });
  if (!started.ok) throw new Error(started.error.message);
  return started.value;
}

async function acceptCredential(
  core: Core,
  actor: "machine" | "user",
  principal: string,
  ref: string,
  operations: string[],
  token: string,
): Promise<void> {
  assert(core.acceptTestCredential !== undefined);
  const context = {
    principal,
    actor,
    credential_ref: ref,
    scope: { operations, targets: {} },
    conditions: {},
  };
  const accepted = await core.acceptTestCredential(context, token);
  assert(accepted.ok, accepted.ok ? "" : accepted.error.message);
  const recorded = await core.record(context);
  assert(recorded.ok, recorded.ok ? "" : recorded.error.message);
}

async function callCore(
  core: Core,
  token: string,
  path: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`http://127.0.0.1:${core.port}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

// 설치 machine이 하는 일: 소스를 묶고 안내를 준비해 register_version을 부르고 읽기 전용 사본을 둔다.
function installSdk(
  core: Core,
  machineToken: string,
  home: string,
  sourceRoot: string,
  name: string,
  kind: "component" | "capability",
  version: string,
) {
  return installPackage(
    name,
    "update-lophn flow package",
    kind,
    version,
    new TextEncoder().encode(GUIDE_TEXT(version)),
    {
      dataRoot: home,
      sourceRoot,
      prepareBlob: async (input) => {
        const prepared = await core.prepareBlob(input);
        return prepared.ok ? ok(prepared.value) : prepared;
      },
      registerVersion: async (input): Promise<Result<unknown>> => {
        const registered = await callCore(
          core,
          machineToken,
          "/v1/packages/register_version",
          {
            input,
            idempotency_key: `update-lophn-5-${name}-${version}-${
              input.bundle_hash.slice(0, 8)
            }`,
            compare: {},
            prepared: [],
          },
        );
        if (registered.status === 200) return ok(registered.body);
        return err({
          code: registered.status === 409 ? "conflict" : "invalid_input",
          message: JSON.stringify(registered.body),
        });
      },
    },
  );
}

async function writeSdkSource(
  root: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [name, text] of Object.entries(files)) {
    await Deno.mkdir(`${root}/${name}`, { recursive: true });
    await Deno.writeTextFile(`${root}/${name}/mod.ts`, text);
  }
}

// 폴더 아래 모든 항목의 상대 경로, 권한, 내용 hash.
async function treeFacts(root: string, prefix = ""): Promise<string[]> {
  const found: string[] = [];
  const entries: Deno.DirEntry[] = [];
  for await (const entry of Deno.readDir(`${root}${prefix}`)) {
    entries.push(entry);
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const entry of entries) {
    const path = `${prefix}/${entry.name}`;
    const stat = await Deno.stat(`${root}${path}`);
    const mode = ((stat.mode ?? 0) & 0o777).toString(8);
    if (entry.isDirectory) {
      found.push(`${path}/ ${mode}`);
      found.push(...await treeFacts(root, path));
    } else {
      found.push(
        `${path} ${mode} ${await sha256Hex(
          await Deno.readFile(`${root}${path}`),
        )}`,
      );
    }
  }
  return found;
}

function dumpTable(home: string, table: string): string {
  const db = new DatabaseSync(`${home}/lophn.db`, { readOnly: true });
  try {
    return JSON.stringify(
      db.prepare(`select * from ${table} order by rowid`).all(),
    );
  } finally {
    db.close();
  }
}

Deno.test({
  name:
    "apps/sdk#R8 apps/sdk#R10 apps/sdk#R11 apps/releases#R8 flow update-lophn 5: update는 새 SDK version만 더하고 기존 앱의 고정 SDK와 release는 그대로이며 activation 결정을 대신하지 않는다",
  ignore: Deno.env.get("LOPHN_E2E") !== "1",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const root = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-e2e-update-sdk-" }),
    );
    const home = `${root}/data`;
    await Deno.mkdir(home, { mode: 0o700 });
    await Deno.chmod(home, 0o700);
    const oldSource = `${root}/source-old`;
    const newSource = `${root}/source-new`;
    const changedSource = `${root}/source-changed`;
    await writeSdkSource(oldSource, { sample: SDK_OLD });
    await writeSdkSource(newSource, {
      sample: SDK_NEW,
      "sample-extra": SDK_EXTRA_MOD,
    });
    await writeSdkSource(changedSource, { sample: SDK_CHANGED });
    let core: Core | undefined;
    try {
      // 옛 lophn: SDK 1.0.0을 설치하고 그 판을 고정한 앱의 active release를 둔다.
      core = await bootApps(home);
      const oldMachine = "m".repeat(43);
      await acceptCredential(
        core,
        "machine",
        "machine:install",
        "cred_update5_old_m",
        ["package.register_version"],
        oldMachine,
      );
      const first = await installSdk(
        core,
        oldMachine,
        home,
        oldSource,
        SDK_NAME,
        "component",
        "1.0.0",
      );
      assert(first.ok, first.ok ? "" : first.error.message);
      const oldBundleHash = first.value.bundle_hash;
      const oldCopy = `${home}/sdk/sample/1.0.0`;
      assertEquals(await Deno.readTextFile(`${oldCopy}/mod.ts`), SDK_OLD);

      const blueprint: Blueprint = {
        name: "Calendar",
        description: "Keeps one calendar",
        screens: [{
          key: "home",
          label: "Home",
          path: "/home",
          sizes: ["full"],
        }],
        commands: [{
          key: "list",
          label: "list",
          description: "list purpose",
          effect: "read",
          confirm: false,
          input: null,
          revert: { supported: false },
        }],
        automatic_tasks: [],
        permissions: [],
        problem_codes: [],
        documents: [],
        agent_context: [],
        app_connections: [],
        sdk_dependencies: [{ name: SDK_NAME, version: "1.0.0" }],
      };
      const blueprintJson = canonicalJson(blueprint as never);
      const blueprintHash = await sha256Hex(blueprintJson);
      const mainSource = "export const one = 1;\n";
      const importMapJson = JSON.stringify({
        imports: { [APP_SDK_MODULE]: "./sdk/sample/1.0.0/mod.ts" },
      });
      const manifest = {
        entrypoint: "main.ts",
        files: [
          { path: "blueprint.json", hash: blueprintHash },
          { path: "main.ts", hash: await sha256Hex(mainSource) },
          { path: "import-map.json", hash: await sha256Hex(importMapJson) },
          { path: "sdk/sample/1.0.0/mod.ts", hash: await sha256Hex(SDK_OLD) },
        ],
        sdk_dependencies: [{ name: SDK_NAME, version: "1.0.0" }],
      };
      const bundleHash = await sha256Hex(JSON.stringify(manifest));
      const copy = bundleCopyPath(home, APP, bundleHash);
      assert(copy.ok);
      const sealed = await sealBundle({
        copyPath: copy.value,
        manifest,
        blueprintJson: new TextEncoder().encode(blueprintJson),
        bundleFiles: [
          {
            path: "import-map.json",
            bytes: new TextEncoder().encode(importMapJson),
          },
          { path: "main.ts", bytes: new TextEncoder().encode(mainSource) },
          {
            path: "sdk/sample/1.0.0/mod.ts",
            bytes: new TextEncoder().encode(SDK_OLD),
          },
        ],
      });
      assert(sealed.ok, sealed.ok ? "" : sealed.error.message);
      // 앱이 실제로 쓰는 판은 봉인 사본 안의 1.0.0이다. 앱 감독이 앱을 띄우지 않게 run을 끈다.
      seedLedger(home, blueprintJson, bundleHash, 0);
      const pinned = await import(
        `file://${copy.value}/sdk/sample/1.0.0/mod.ts`
      );
      assertEquals(pinned.sdkVersion, "1.0.0");

      const beforeApp = dumpTable(home, "apps");
      const beforeReleases = dumpTable(home, "releases");
      const beforeTests = dumpTable(home, "release_tests");
      const beforeEvents = eventsOf(home);
      const beforeBundle = await treeFacts(copy.value);
      const beforeOldCopy = await treeFacts(oldCopy);
      assert(
        beforeBundle.some((line) => line.startsWith("/sdk/sample/1.0.0/")),
      );
      assertEquals(await core.shutdown(), undefined);
      core = undefined;

      // update한 lophn: 같은 data root로 다시 시작해 새 SDK version을 더한다.
      core = await bootApps(home);
      const newMachine = "n".repeat(43);
      const human = "h".repeat(43);
      await acceptCredential(
        core,
        "machine",
        "machine:install",
        "cred_update5_new_m",
        ["package.register_version"],
        newMachine,
      );
      await acceptCredential(
        core,
        "user",
        "user-1",
        "cred_update5_user",
        ["app.get", "packages.list", "packages.versions"],
        human,
      );
      const restartedVersions = await callCore(
        core,
        human,
        "/v1/packages/versions",
        { name: SDK_NAME },
      );
      assertEquals(restartedVersions.status, 200);
      const restartedList = restartedVersions.body["versions"] as {
        version: string;
        bundle_hash: string;
        guide_hash: string;
      }[];
      assertEquals(restartedList.map((row) => row.version), ["1.0.0"]);
      assertEquals(restartedList[0].bundle_hash, oldBundleHash);

      const next = await installSdk(
        core,
        newMachine,
        home,
        newSource,
        SDK_NAME,
        "component",
        "1.1.0",
      );
      assert(next.ok, next.ok ? "" : next.error.message);
      const extra = await installSdk(
        core,
        newMachine,
        home,
        newSource,
        SDK_EXTRA,
        "capability",
        "1.0.0",
      );
      assert(extra.ok, extra.ok ? "" : extra.error.message);
      assert(next.value.bundle_hash !== oldBundleHash);

      // 이미 공개한 1.0.0을 다른 byte로 다시 공개하려는 update는 거절되고 사본도 그대로다.
      const changed = await installSdk(
        core,
        newMachine,
        home,
        changedSource,
        SDK_NAME,
        "component",
        "1.0.0",
      );
      assert(!changed.ok);
      assertEquals(changed.error.code, "conflict");

      const versions = await callCore(
        core,
        human,
        "/v1/packages/versions",
        { name: SDK_NAME },
      );
      assertEquals(versions.status, 200, JSON.stringify(versions.body));
      const list = versions.body["versions"] as {
        version: string;
        bundle_hash: string;
        guide_hash: string;
      }[];
      assertEquals(list.map((row) => row.version), ["1.0.0", "1.1.0"]);
      assertEquals(list[0], restartedList[0]);
      assertEquals(list[1].bundle_hash, next.value.bundle_hash);
      assertEquals(list[1].guide_hash, next.value.guide_hash);
      const catalog = await callCore(core, human, "/v1/packages/list", {});
      assertEquals(catalog.status, 200, JSON.stringify(catalog.body));
      assertEquals(
        (catalog.body["packages"] as { name: string }[]).map((row) => row.name)
          .sort(),
        [SDK_NAME, SDK_EXTRA],
      );

      // 앱은 그대로 같은 active release다. update가 release를 만들거나 바꾸지 않았다.
      const shown = await callCore(core, human, "/v1/apps/get", { app: APP });
      assertEquals(shown.status, 200, JSON.stringify(shown.body));
      assertEquals(
        (shown.body["app"] as { active_release: string }).active_release,
        RELEASE_ID,
      );
      assertEquals(await core.shutdown(), undefined);
      core = undefined;

      assertEquals(dumpTable(home, "apps"), beforeApp);
      assertEquals(dumpTable(home, "releases"), beforeReleases);
      assertEquals(dumpTable(home, "release_tests"), beforeTests);
      assertEquals(countOf(home, "releases"), 1);
      const releaseStatus = new DatabaseSync(`${home}/lophn.db`, {
        readOnly: true,
      });
      try {
        const row = releaseStatus.prepare(
          "select status, activation from releases where id = ?",
        ).get(RELEASE_ID);
        assertEquals(row?.["status"], "active");
        assertEquals(row?.["activation"], null);
      } finally {
        releaseStatus.close();
      }
      const afterEvents = eventsOf(home);
      assertEquals(afterEvents.slice(0, beforeEvents.length), beforeEvents);
      const added = afterEvents.slice(beforeEvents.length).map((row) =>
        row.type
      );
      assertEquals(added, [
        "PackageVersionRegistered",
        "PackageVersionRegistered",
      ]);

      // 봉인 bundle 사본과 설치된 1.0.0 사본은 byte·권한 그대로, 새 version은 읽기 전용 사본으로 따로 선다.
      assertEquals(await treeFacts(copy.value), beforeBundle);
      assertEquals(await treeFacts(oldCopy), beforeOldCopy);
      assertEquals(await Deno.readTextFile(`${oldCopy}/mod.ts`), SDK_OLD);
      const newCopy = `${home}/sdk/sample/1.1.0`;
      assertEquals(await Deno.readTextFile(`${newCopy}/mod.ts`), SDK_NEW);
      assertEquals(
        ((await Deno.stat(`${newCopy}/mod.ts`)).mode ?? 0) & 0o777,
        0o444,
      );
      assertEquals(
        ((await Deno.stat(newCopy)).mode ?? 0) & 0o777,
        0o555,
      );
      assert((await Deno.stat(`${home}/sdk/sample-extra/1.0.0/mod.ts`)).isFile);
      // 앱이 실제로 읽는 판은 새 설치 판이 아니라 고정한 1.0.0이다.
      const stillPinned = await import(
        `file://${copy.value}/sdk/sample/1.0.0/mod.ts`
      );
      assertEquals(stillPinned.sdkVersion, "1.0.0");
      const installedNew = await import(`file://${newCopy}/mod.ts`);
      assertEquals(installedNew.sdkVersion, "1.1.0");
      const bundleMap = JSON.parse(
        await Deno.readTextFile(`${copy.value}/import-map.json`),
      ) as { imports: Record<string, string> };
      assertEquals(
        bundleMap.imports[APP_SDK_MODULE],
        "./sdk/sample/1.0.0/mod.ts",
      );
    } finally {
      if (core !== undefined) await core.shutdown();
      await removeTree(root);
    }
  },
});

const AGENT_PLAN: Script = {
  steps: [
    {
      id: "plan",
      protocol: "messages" as const,
      reply: {
        text: "I will list projects and write two notes.",
        toolCalls: [
          { id: "toolu_1", name: "project.list", arguments: "{}" },
          {
            id: "toolu_2",
            name: "document.create",
            arguments: JSON.stringify({ note: "one" }),
          },
          {
            id: "toolu_3",
            name: "document.create",
            arguments: JSON.stringify({ note: "two" }),
          },
        ],
        usage: { input: 20, output: 8 },
        stop: "tool_calls" as const,
      },
    },
    {
      id: "done",
      protocol: "messages" as const,
      reply: {
        text: "All three are done.",
        usage: { input: 40, output: 9 },
        stop: "end" as const,
      },
    },
  ],
};
const AGENT_ASK: Script = {
  steps: [
    {
      id: "ask",
      protocol: "messages" as const,
      reply: {
        text: "I need a person to confirm this write.",
        toolCalls: [{
          id: "toolu_1",
          name: "document.save_version",
          arguments: JSON.stringify({ note: "approve me" }),
        }],
        usage: { input: 20, output: 8 },
        stop: "tool_calls" as const,
      },
    },
    AGENT_PLAN.steps[1]!,
  ],
};

function agentRows(world: RecoveryWorld, sql: string) {
  return inspect(world.server, sql, [world.run]);
}

function agentToolRows(world: RecoveryWorld) {
  return agentRows(
    world,
    `select response_key as key, state, json_extract(outcome, '$.kind') as kind
     from tool_calls where run = ? order by response_order, attempt`,
  );
}

function agentRun(world: RecoveryWorld) {
  return agentRows(
    world,
    "select state, outcome_kind, outcome_reason from runs where id = ?",
  )[0]!;
}

function runEvents(world: RecoveryWorld, type: string): number {
  return count(
    world.server,
    `select count(*) as n from events where type = '${type}'`,
  );
}

// 일이 중단 지점에서 죽는다. update가 진행 중이던 runtime을 멈춘 것과 같다.
async function runUntilStopped(
  world: RecoveryWorld,
  die: NonNullable<Parameters<RecoveryWorld["runtime"]>[0]>["die"],
) {
  const first = world.runtime({ die });
  const started = await first.driver.startNext();
  assert(started.kind === "started", JSON.stringify(started));
  assertEquals(started.run, world.run);
  await started.done;
  assert(first.dead());
}

// 사람에게는 보이지 않는 복구: 사람의 새 메시지·approval·question이 생기지 않는다.
function assertNothingAskedOfPerson(world: RecoveryWorld, approvals = 0) {
  assertEquals(
    count(
      world.server,
      "select count(*) as n from messages where actor = 'user'",
    ),
    1,
  );
  assertEquals(
    count(world.server, "select count(*) as n from approval_requests"),
    approvals,
  );
  assertEquals(count(world.server, "select count(*) as n from runs"), 1);
}

Deno.test({
  name:
    "lophn-agent/harness/waiting-and-recovery#R8 lophn-agent/harness/waiting-and-recovery#R9 lophn-agent/harness/waiting-and-recovery#R10 platform/backup-and-migration#R16 platform/backup-and-migration#R17 flow update-lophn 6: update로 끊긴 agent 일은 저장된 경계에서 복구하고 결과를 모르는 쓰기는 반복하지 않는다",
  ignore: Deno.env.get("LOPHN_E2E") !== "1",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    await t.step(
      "완전 응답과 확정 결과는 반복하지 않고 셋째 call부터 같은 run으로 이어 간다",
      async () => {
        const world = await openRecoveryWorld(AGENT_PLAN);
        try {
          await runUntilStopped(world, {
            when: "after",
            path: "/v1/tool-calls/finish",
            nth: 2,
          });
          assertEquals(agentRun(world)["state"], "running");
          assertEquals(world.effects.writes, ["one"]);

          // update: 같은 데이터 root로 core가 다시 선다. 재기동만으로는 아무 일도 다시 하지 않는다.
          await world.restartCore();
          world.clock.advance(60_000);
          assertEquals(agentRun(world)["state"], "running");
          assertEquals(world.provider.requests().length, 1);
          assertEquals(world.effects.writes, ["one"]);

          const report = await world.runtime().driver.recover();
          assert(report.ok);
          assertEquals(report.value.map((entry) => entry.result), ["resumed"]);
          assertEquals(await report.value[0]!.done!, {
            kind: "finished",
            outcome: { kind: "completed", reason: "answer_completed" },
          });
          // 반복 없음: 완전 응답은 계획과 마무리 둘, 읽기는 한 번, 쓰기는 둘째·셋째 한 번씩.
          assertEquals(world.provider.requests().length, 2);
          assertEquals(world.effects.reads, 1);
          assertEquals(world.effects.writes, ["one", "two"]);
          assertEquals(
            agentToolRows(world).map((row) => [row["key"], row["kind"]]),
            [["toolu_1", "success"], ["toolu_2", "success"], [
              "toolu_3",
              "success",
            ]],
          );
          assertEquals(agentRun(world)["outcome_kind"], "completed");
          assertEquals(runEvents(world, "RunRecovered"), 1);
          assertNothingAskedOfPerson(world);
          // 이어 간 판단은 앞 응답과 세 결과를 이력으로 받았다.
          const final = JSON.stringify(world.provider.requests()[1]!.body);
          assert(final.includes("Wrote one.") && final.includes("Wrote two."));
          // 다음 기동에도 끝난 일은 건드리지 않는다.
          await world.restartCore();
          const again = await world.runtime().driver.recover();
          assert(again.ok);
          assertEquals(again.value, []);
          assertEquals(world.effects.writes, ["one", "two"]);
        } finally {
          await world.dispose();
        }
      },
    );

    await t.step(
      "결과를 모르는 쓰기는 조회가 없으면 다시 보내지 않고 불명확 효과와 남은 일로 끝낸다",
      async () => {
        const world = await openRecoveryWorld(AGENT_PLAN);
        try {
          // 첫째 쓰기의 효과는 일어났고 결과 기록이 유실된 채 update가 runtime을 멈춘다.
          await runUntilStopped(world, {
            when: "before",
            path: "/v1/tool-calls/finish",
            nth: 2,
          });
          assertEquals(world.effects.writes, ["one"]);
          assertEquals(agentToolRows(world)[1]!["state"], "started");

          await world.restartCore();
          world.clock.advance(1000);
          const report = await world.runtime().driver.recover();
          assert(report.ok);
          assertEquals(report.value.map((entry) => entry.result), ["finished"]);
          // 다시 보내지 않았고 셋째 call도, 뒤 판단 model도 시작하지 않았다.
          assertEquals(world.effects.writes, ["one"]);
          assertEquals(world.provider.requests().length, 1);
          const run = agentRun(world);
          assertEquals(
            [run["state"], run["outcome_kind"], run["outcome_reason"]],
            ["finished", "failed", "effect_unknown"],
          );
          // 성공이나 미실행으로 채우지 않고 불명확 효과와 남은 일을 따로 남긴다.
          assertEquals(agentToolRows(world).map((row) => row["kind"]), [
            "success",
            "uncertain",
            "not_executed",
          ]);
          const facts = JSON.parse(String(
            agentRows(
              world,
              "select result_facts as f from runs where id = ?",
            )[0]!["f"],
          ));
          assertEquals(facts.confirmed.unknown_effects.length, 1);
          assertEquals(facts.confirmed.unexecuted.length, 1);
          assertNothingAskedOfPerson(world);
          // 다음 기동도 같은 효과를 반복하지 않는다.
          await world.restartCore();
          const again = await world.runtime().driver.recover();
          assert(again.ok);
          assertEquals(again.value, []);
          assertEquals(world.effects.writes, ["one"]);
        } finally {
          await world.dispose();
        }
      },
    );

    await t.step(
      "소유 계약의 결과 조회로 확정한 쓰기는 그 결과를 쓰고 다시 보내지 않는다",
      async () => {
        const world = await openRecoveryWorld(AGENT_PLAN);
        try {
          await runUntilStopped(world, {
            when: "before",
            path: "/v1/tool-calls/finish",
            nth: 2,
          });
          await world.restartCore();
          const asked: string[] = [];
          const lookup: ToolLookup = (call) => {
            asked.push(call.tool_call);
            return Promise.resolve({
              outcome: { kind: "success" as const, code: "ok" },
              result: {
                status: "success" as const,
                summary: "Wrote one.",
                content: { note: "one" },
                complete: true,
                source: null,
                continuation: null,
                pending: [],
              },
            });
          };
          const report = await world.runtime({
            lookups: new Map([["document.create", lookup]]),
          }).driver.recover();
          assert(report.ok);
          assertEquals(report.value.map((entry) => entry.result), ["resumed"]);
          await report.value[0]!.done!;
          // 조회한 call은 하나이고 그 쓰기는 다시 실행하지 않았다. 셋째 쓰기만 새로 한 번 했다.
          assertEquals(asked.length, 1);
          assertEquals(world.effects.writes, ["one", "two"]);
          assertEquals(agentToolRows(world).map((row) => row["kind"]), [
            "success",
            "success",
            "success",
          ]);
          assertEquals(agentRun(world)["outcome_kind"], "completed");
          assertNothingAskedOfPerson(world);
        } finally {
          await world.dispose();
        }
      },
    );

    await t.step(
      "update가 오래 걸려도 누적 한도는 초기화되지 않아 한도를 넘으면 새 진입 없이 확정 결과를 남기고 끝낸다",
      async () => {
        const world = await openRecoveryWorld(AGENT_PLAN);
        try {
          await runUntilStopped(world, {
            when: "after",
            path: "/v1/tool-calls/finish",
            nth: 2,
          });
          await world.restartCore();
          // 기본 stall 한도는 5분이다. 꺼져 있던 6분을 센다.
          world.clock.advance(6 * 60_000);
          const report = await world.runtime().driver.recover();
          assert(report.ok);
          assertEquals(report.value.map((entry) => entry.result), ["resumed"]);
          assertEquals(await report.value[0]!.done!, {
            kind: "finished",
            outcome: { kind: "failed", reason: "stall_limit" },
          });
          assertEquals(world.provider.requests().length, 1);
          assertEquals(world.effects.writes, ["one"]);
          assertEquals(agentToolRows(world).map((row) => row["kind"]), [
            "success",
            "success",
            "not_executed",
          ]);
          assertNothingAskedOfPerson(world);
        } finally {
          await world.dispose();
        }
      },
    );

    await t.step(
      "approval을 기다리던 일은 update 뒤에도 결정을 기다리고 허락 한 번으로 그 call 하나만 한 번 실행한다",
      async () => {
        const world = await openRecoveryWorld(AGENT_ASK);
        try {
          const first = world.runtime();
          const started = await first.driver.startNext();
          assert(started.kind === "started", JSON.stringify(started));
          assertEquals((await started.done).kind, "waiting");
          assertEquals(agentRun(world)["state"], "waiting_user");
          const approval = inspect(
            world.server,
            "select id from approval_requests where run = ?",
            [world.run],
          )[0]!["id"] as string;

          await world.restartCore();
          // 결정이 없으면 계속 기다린다. 기다림을 허락이나 거절로 바꾸지 않는다.
          const waiting = await world.runtime().driver.recover();
          assert(waiting.ok);
          assertEquals(waiting.value.map((entry) => entry.result), ["waiting"]);
          assertEquals(world.effects.writes, []);
          assertEquals(agentRun(world)["state"], "waiting_user");

          const read = await world.read("approvals/get", USER_TOKEN, {
            approval,
          });
          const decided = await humanDecide(
            world.server,
            USER_TOKEN,
            (read.body as { request: never })["request"],
            "grant",
            null,
          );
          assertEquals(decided.status, 200, JSON.stringify(decided.body));
          await world.restartCore();
          const report = await world.runtime().driver.recover();
          assert(report.ok);
          assertEquals(report.value.map((entry) => entry.result), ["resumed"]);
          assertEquals((await report.value[0]!.done!).kind, "finished");
          assertEquals(world.effects.writes, ["approve me"]);
          assertEquals(agentRun(world)["outcome_kind"], "completed");
          // 같은 허락으로 그 call의 진입은 한 번이다.
          assertEquals(runEvents(world, "ToolCallStarted"), 1);
          assertNothingAskedOfPerson(world, 1);
          const again = await world.runtime().driver.recover();
          assert(again.ok);
          assertEquals(again.value, []);
          assertEquals(world.effects.writes, ["approve me"]);
        } finally {
          await world.dispose();
        }
      },
    );
  },
});

// 7단계. 프로젝트 등록·추적은 화면이 없는 사람 조작이라 core 통로(사람 token)로 하고, 탭 열기·
// 읽기 위치·터미널·settings의 정상 정지는 화면으로 한다.
const GONE_DOCUMENT = "doc_01m4jarqepdwdcnxj75vykyd00";
const LATER_TEXT = [
  "# Later",
  "",
  "Keep this sentence.",
  ...Array.from(
    { length: 80 },
    (_, index) => `\nParagraph ${index} stays in the first version.`,
  ),
  "",
].join("\n");

type StoredTab = {
  kind: string;
  key: string;
  document?: string;
  project_folder?: string;
  read_position?: { scroll_offset?: number };
};

async function storedPanes(
  home: string,
): Promise<{ tabs: StoredTab[]; selected_tab: string | null }[] | null> {
  try {
    const parsed = JSON.parse(
      await Deno.readTextFile(`${home}/shell/layout.json`),
    ) as {
      layout: { panes: { tabs: StoredTab[]; selected_tab: string | null }[] };
    };
    return parsed.layout.panes;
  } catch {
    return null;
  }
}

async function untilStored(
  home: string,
  ready: (
    panes: { tabs: StoredTab[]; selected_tab: string | null }[],
  ) => boolean,
  what: string,
): Promise<void> {
  const deadline = Date.now() + 60_000;
  let last: unknown = null;
  while (Date.now() < deadline) {
    const panes = await storedPanes(home);
    last = panes;
    if (panes !== null && ready(panes)) return;
    await delay(200);
  }
  throw new Error(`${what}: ${JSON.stringify(last)}`);
}

async function tabKeys(flow: FlowShell): Promise<string[]> {
  return JSON.parse(
    String(
      await flow.evaluate(
        `JSON.stringify([...document.querySelectorAll("[role=tab]")].map((el) => el.getAttribute("data-tab")))`,
      ),
    ),
  ) as string[];
}

Deno.test({
  name:
    "shell/workspace#R6 shell/workspace#R7 documents/versions#R8 flow update-lophn 7: update 뒤 다시 연 프로젝트가 탭·선택 탭·읽던 위치를 이어 쓰고 터미널은 종료된 자리표시로 남는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const os = Deno.build.os;
    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-update-ws-" });
    await Deno.chmod(home, 0o700);
    const pack = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-e2e-update-ws-pkg-" }),
    );
    const install = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-e2e-update-ws-install-" }),
    );
    const folder = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-e2e-update-ws-folder-" }),
    );
    const metadata = `${pack}/lophn-update.json`;
    const ranFile = `${folder}/terminal-ran.txt`;
    await Deno.writeTextFile(`${folder}/notes.md`, "# Notes\n\nShort note.\n");
    await Deno.writeTextFile(`${folder}/later.md`, LATER_TEXT);
    const env = { LOPHN_INSTALL_ROOT: install };
    let opened: FlowShell | undefined;
    try {
      const flow = await openFlowShell({ home, env, pickFolder: metadata });
      opened = flow;
      await registerTrackedProject(flow, {
        folder,
        name: "alpha",
        title: "Alpha",
      });
      await untilDocuments(
        flow,
        ["notes", "later"],
        "추적한 파일이 문서가 되지 않았다",
      );
      const notesId = (await documentTitled(flow, "notes")).id;
      const laterId = (await documentTitled(flow, "later")).id;
      let terminalKey = "";

      await t.step(
        "shell/workspace#R6: 문서 둘과 터미널을 열고 읽던 위치를 남긴다",
        async () => {
          // launcher는 목록을 처음 한 번만 읽는다. 공간을 한 번 다녀와 등록한 프로젝트를 받는다.
          await flow.click("[data-entry=lophn]");
          await flow.until(
            `document.querySelector("[data-space]")?.getAttribute("data-space") === "lophn"`,
            "lophn 공간이 서지 않았다",
          );
          await flow.click("[data-launcher-back]");
          await flow.until(
            `document.querySelector('[data-card="project"][data-project="${WORKSPACE_PROJECT}"] button:not([data-details-toggle])') !== null`,
            "프로젝트 카드가 없다",
          );
          await flow.click(
            `[data-card="project"][data-project="${WORKSPACE_PROJECT}"] button:not([data-details-toggle])`,
          );
          await flow.until(
            `document.querySelector("[data-space]")?.getAttribute("data-space") === "project"`,
            "project 작업대가 서지 않았다",
          );
          await flow.until(
            `document.querySelector('[data-document="${notesId}"]') !== null`,
            "sidebar에 문서가 없다",
          );
          await flow.click(`[data-document="${notesId}"]`);
          await flow.until(
            `document.querySelector('[data-tab="${notesId}"]') !== null`,
            "notes 탭이 열리지 않았다",
          );
          await flow.click("[data-open-terminal]");
          await flow.until(
            `document.querySelector('[data-terminal-tab][data-phase="live"]') !== null`,
            "터미널이 시작되지 않았다",
          );
          terminalKey = String(
            await flow.evaluate(
              `document.querySelector('[data-terminal-tab]').getAttribute("data-terminal-tab")`,
            ),
          );
          // 사람이 터미널에 명령을 쳤다. 이 명령은 update 뒤에 다시 실행되면 안 된다.
          await flow.mouseClick(`[data-terminal-tab="${terminalKey}"] .xterm`);
          await delay(1500);
          const page = await flow.shell.connect("://desktop/");
          await page.command("Input.insertText", {
            text: `echo ran >> ${JSON.stringify(ranFile)}`,
          });
          for (const type of ["keyDown", "keyUp"]) {
            await page.command("Input.dispatchKeyEvent", {
              type,
              key: "Enter",
              code: "Enter",
              windowsVirtualKeyCode: 13,
              ...(type === "keyDown" ? { text: "\r" } : {}),
            });
          }
          const deadline = Date.now() + 30_000;
          while (Date.now() < deadline) {
            try {
              if ((await Deno.readTextFile(ranFile)) === "ran\n") break;
            } catch {
              // 아직 없다.
            }
            await delay(200);
          }
          assertEquals(await Deno.readTextFile(ranFile), "ran\n");

          await flow.click(`[data-document="${laterId}"]`);
          await flow.until(
            `document.querySelector("[data-document-view]")?.getAttribute("data-document-view") === "read" && document.querySelector("[data-document-body]")?.textContent?.includes("Keep this sentence.")`,
            "later 본문이 열리지 않았다",
          );
          await flow.until(
            `(() => { const el = document.querySelector("[data-document-view]"); return !!el && el.scrollHeight > el.clientHeight + 40; })()`,
            "본문이 스크롤되지 않는다",
          );
          const placed = await flow.evaluate(`(() => {
            const el = document.querySelector("[data-document-view]");
            el.scrollTop = Math.min(480, el.scrollHeight - el.clientHeight);
            el.dispatchEvent(new Event("scroll"));
            return el.scrollTop;
          })()`);
          assert(Number(placed) > 0, `scrollTop이 0이다: ${placed}`);
          await untilStored(
            home,
            (panes) =>
              panes.some((pane) =>
                pane.selected_tab === laterId &&
                pane.tabs.some((tab) =>
                  tab.document === laterId &&
                  (tab.read_position?.scroll_offset ?? 0) > 0
                ) &&
                pane.tabs.some((tab) => tab.kind === "terminal")
              ),
            "layout에 탭과 읽던 위치가 남지 않았다",
          );
          assertEquals(await tabKeys(flow), [notesId, terminalKey, laterId]);
        },
      );

      await t.step(
        "platform/install-and-update#R14: settings의 정상 정지로 update를 멈춘다",
        async () => {
          await flow.click("[data-entry=lophn]");
          await flow.until(
            `document.querySelector("[data-space]")?.getAttribute("data-space") === "lophn"`,
            "lophn 공간이 서지 않았다",
          );
          await flow.click("[data-screen=settings]");
          await openUpdate(flow);
          const before = await platformStatus(flow);
          await Deno.writeTextFile(
            metadata,
            JSON.stringify({
              version: OFFERED,
              os,
              format: formatOf(os),
              schema: before.schema,
            }),
          );
          await flow.click("[data-action='choose-package']");
          await flow.until(
            `document.querySelector("[data-notice='ready']") !== null`,
            "수동 update 안내가 오지 않았다",
          );
          await flow.click("[data-action='stop-and-update']");
          await flow.until(
            `document.querySelector("[data-stop='stopped'], [data-stop='failed']") !== null`,
            "정상 정지가 끝나지 않았다",
            90_000,
          );
          assertEquals(
            (await flow.text("[data-stop='stopped']"))?.trim(),
            "lophn stopped cleanly. Start lophn again.",
          );
          await flow.close();
          opened = undefined;
        },
      );

      // update로 멈춰 있는 동안 문서 하나가 사라졌다고 본다. 저장된 배치에 지금은 없는 문서의 탭을 둔다.
      const stored = JSON.parse(
        await Deno.readTextFile(`${home}/shell/layout.json`),
      ) as { layout: { panes: { tabs: StoredTab[] }[] } };
      stored.layout.panes[0]!.tabs.push({
        kind: "document_editor",
        key: GONE_DOCUMENT,
        document: GONE_DOCUMENT,
      });
      await Deno.writeTextFile(
        `${home}/shell/layout.json`,
        JSON.stringify(stored),
      );
      const again = await openFlowShell({ home, env });
      opened = again;

      await t.step(
        "shell/workspace#R6 documents/versions#R8: 다시 연 프로젝트가 탭 순서·선택 탭·읽던 위치를 이어 쓴다",
        async () => {
          await again.until(
            `document.querySelector("[data-space]")?.getAttribute("data-space") === "launcher"`,
            "다시 연 launcher가 서지 않았다",
          );
          await again.click(
            `[data-card="project"][data-project="${WORKSPACE_PROJECT}"] button:not([data-details-toggle])`,
          );
          await again.until(
            `document.querySelector("[data-space]")?.getAttribute("data-space") === "project"`,
            "이어서 연 작업대가 서지 않았다",
          );
          await again.until(
            `document.querySelector('[data-tab="${laterId}"]')?.getAttribute("aria-selected") === "true"`,
            "선택 탭이 돌아오지 않았다",
          );
          // 사라진 문서의 탭도 다른 문서로 바뀌지 않고 그 자리에 남는다.
          assertEquals(await tabKeys(again), [
            notesId,
            terminalKey,
            laterId,
            GONE_DOCUMENT,
          ]);
          await again.until(
            `(() => { const el = document.querySelector("[data-document-view]"); return !!el && el.scrollTop > 0; })()`,
            "읽던 위치가 돌아오지 않았다",
          );
          assert(
            String(await again.text("[data-document-body]")).includes(
              "Keep this sentence.",
            ),
          );
        },
      );

      await t.step(
        "shell/workspace#R7: 터미널은 종료된 자리표시로 남고 사람이 새로 시작하기 전에는 명령을 다시 실행하지 않는다",
        async () => {
          await again.click(`[data-tab="${terminalKey}"]`);
          await again.until(
            `document.querySelector('[data-terminal-tab="${terminalKey}"]')?.getAttribute("data-phase") === "idle"`,
            "터미널이 시작 전 자리표시가 아니다",
          );
          assertEquals(
            await again.count(
              `[data-terminal-tab="${terminalKey}"] [data-restart]`,
            ),
            1,
          );
          assertEquals(
            await again.count(
              `[data-terminal-tab="${terminalKey}"] [data-exit-banner="not_started"]`,
            ),
            1,
          );
          assertEquals(
            await again.evaluate(
              `document.querySelector('[data-terminal-tab="${terminalKey}"] [data-terminal-screen]').hidden`,
            ),
            true,
          );
          await delay(1500);
          assertEquals(await Deno.readTextFile(ranFile), "ran\n");
          // 사람이 새로 시작하면 새 shell이다. 옛 명령은 다시 실행되지 않는다.
          await again.click(
            `[data-terminal-tab="${terminalKey}"] [data-restart]`,
          );
          await again.until(
            `document.querySelector('[data-terminal-tab="${terminalKey}"]')?.getAttribute("data-phase") === "live"`,
            "사람이 누른 뒤에도 터미널이 시작되지 않았다",
          );
          await delay(1500);
          assertEquals(await Deno.readTextFile(ranFile), "ran\n");
        },
      );
      // 제품 결함: shell main의 restoreLayout(없거나 못 쓰는 대상을 이유 있는 자리표시로 바꿈)은
      // renderer 복원 길에 이어져 있지 않다. 지금은 일반 "Couldn't load this document."와 Reload만
      // 보여 없는 문서라는 이유가 없다. 닫기는 탭 줄에서 된다. shell concern이 잇기 전까지 둔다.
      await t.step({
        name:
          "shell/workspace#R7: 사라진 문서의 탭은 이유와 닫기를 가진 자리표시로 남는다",
        ignore: true,
        async fn() {
          await again.click(`[data-tab="${GONE_DOCUMENT}"]`);
          await again.until(
            `document.querySelector("[data-pane-body]")?.textContent?.length > 0`,
            "사라진 문서 탭 본문이 없다",
          );
          assertEquals(await again.count(`[data-document-view="failed"]`), 0);
          assertEquals(
            await again.count(`[data-tab="${GONE_DOCUMENT}"] [data-close]`),
            1,
          );
        },
      });
    } finally {
      await opened?.close();
      await removeHome(home);
      await Deno.remove(pack, { recursive: true });
      await Deno.remove(install, { recursive: true });
      await Deno.remove(folder, { recursive: true });
    }
  },
});

const UNCONFIRMED_APP = "app_01arz3ndektsv4rrffq69g5faw";

async function healthOf(flow: FlowShell): Promise<{
  observedAt: string;
  observations: {
    component: string;
    available: boolean;
    reason?: string;
    observed_at: string;
  }[];
}> {
  const health = await mustCall(flow, {
    kind: "read",
    resource: "platform",
    method: "health",
    body: {},
  });
  return {
    observedAt: String(health.observed_at),
    observations: health.observations as {
      component: string;
      available: boolean;
      reason?: string;
      observed_at: string;
    }[],
  };
}

Deno.test({
  name:
    "platform/diagnostics#R8 platform/backup-and-migration#R16 apps/runtime#R3 shell/wording#R10 flow update-lophn 8: update 뒤 현재 가용성과 실제 관측 시각을 보이고 확인하지 못한 일을 성공으로 채우지 않는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const os = Deno.build.os;
    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-update-obs-" });
    await Deno.chmod(home, 0o700);
    const pack = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-e2e-update-obs-pkg-" }),
    );
    const install = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-e2e-update-obs-install-" }),
    );
    const metadata = `${pack}/lophn-update.json`;
    const env = { LOPHN_INSTALL_ROOT: install };
    let opened: FlowShell | undefined;
    try {
      const flow = await openFlowShell({
        home,
        start: "settings",
        pickFolder: metadata,
        env,
      });
      opened = flow;
      await openUpdate(flow);
      const before = await platformStatus(flow);
      await Deno.writeTextFile(
        metadata,
        JSON.stringify({
          version: OFFERED,
          os,
          format: formatOf(os),
          schema: before.schema,
        }),
      );
      await flow.click("[data-action='choose-package']");
      await flow.until(
        `document.querySelector("[data-notice='ready']") !== null`,
        "수동 update 안내가 오지 않았다",
      );
      await flow.click("[data-action='stop-and-update']");
      await flow.until(
        `document.querySelector("[data-stop='stopped'], [data-stop='failed']") !== null`,
        "정상 정지가 끝나지 않았다",
        90_000,
      );
      assertEquals(await flow.count("[data-stop='stopped']"), 1);
      await flow.close();
      opened = undefined;

      // update가 끊은 앱 동작 하나. 실행 중으로 남은 채 core가 멈췄다.
      writeLedger(home, (db) => {
        db.prepare(
          `insert into invocations (
             id, app, release, mode, actor, caller, operation, trigger,
             approval, input_hash, status, started_at, finished_at, summary, detail_hash
           ) values (?, ?, ?, 'live', 'user', ?, ?, ?, null, null, 'running', ?, null, '{}', null)`,
        ).run(
          INTERRUPTED,
          UNCONFIRMED_APP,
          INTERRUPTED_RELEASE,
          JSON.stringify({ kind: "direct" }),
          JSON.stringify({ kind: "command", command: "usage.sync" }),
          JSON.stringify({ kind: "direct" }),
          INTERRUPTED_AT,
        );
      });

      const restartedAt = Date.now();
      const again = await openFlowShell({
        home,
        start: "settings",
        pickFolder: metadata,
        env,
      });
      opened = again;
      await openUpdate(again);

      await t.step(
        "platform/diagnostics#R8: 구성 요소별 현재 가용성은 다시 읽은 시각으로 관측하고 불가에는 안전한 이유가 있다",
        async () => {
          const after = await platformStatus(again);
          assertEquals(after.ledgerId, before.ledgerId);
          const first = await healthOf(again);
          assert(first.observations.length > 0);
          assert(
            Date.parse(first.observedAt) >= restartedAt,
            `관측 시각이 재기동보다 앞선다: ${first.observedAt}`,
          );
          for (const observation of first.observations) {
            assertEquals(observation.observed_at, first.observedAt);
            assertEquals(typeof observation.available, "boolean");
            if (!observation.available) {
              assert(
                (observation.reason ?? "") !== "",
                `${observation.component}: 불가인데 이유가 없다`,
              );
            }
          }
          const ledger = first.observations.find((o) =>
            o.component === "ledger"
          );
          assertEquals(ledger?.available, true);
          // 관측은 읽을 때마다 새로 한다. 이전 읽기의 시각을 재사용하지 않는다.
          await delay(20);
          const second = await healthOf(again);
          assert(
            Date.parse(second.observedAt) > Date.parse(first.observedAt),
            `관측 시각이 새로워지지 않았다: ${first.observedAt} ${second.observedAt}`,
          );
        },
      );

      await t.step(
        "platform/backup-and-migration#R16 apps/runtime#R3: 끊긴 앱 동작은 확인 불가로 남고 성공·미실행으로 채우지 않는다",
        () => {
          const interrupted = invocationOf(home);
          assertEquals(interrupted.status, "unknown");
          assertEquals(interrupted.started, INTERRUPTED_AT);
          assertEquals(
            (JSON.parse(interrupted.summary) as { reason?: string }).reason,
            "core_restarted",
          );
        },
      );

      await t.step(
        "shell/wording#R10 platform/install-and-update#R13: 재기동만으로 update 완료나 검증됨을 주장하지 않는다",
        async () => {
          assertEquals(await again.count("[data-stop]"), 0);
          assertEquals(await again.count("[data-notice='ready']"), 0);
          assertEquals(
            (await again.text("[data-deployment]"))?.trim(),
            UNVERIFIED,
          );
          const shown = String(await again.text("[data-update]"));
          assert(!shown.includes("verified"));
          assert(!shown.includes("Download"));
        },
      );

      // 제품 결함(apps/core·worker 조립 몫): 진단 탭은 desktop entry에 이어졌지만 product core가
      // DoctorSource(`runtime.ts`의 `doctor` 입력)를 받지 않아 `diagnostics/check` read가 등록되지
      // 않는다. 그래서 탭의 [Check security]가 `failed`("The check couldn't start right now.")로 끝난다.
      // worker의 observeDoctor는 core에 연결되어 있지 않다. shell settings 안에서 고칠 수 없어 둔다.
      await t.step({
        name:
          "platform/diagnostics#R8 shell/wording#R10: settings 화면이 현재 가용성과 관측 시각을 보인다",
        ignore: true,
        async fn() {
          await again.mouseClickText("[role=tab]", "Diagnose");
          await again.click("[data-action='check']");
          await again.until(
            `document.querySelector("[data-check='ready']") !== null`,
            "진단 결과가 서지 않았다",
          );
          const result = String(await again.text("[data-check-result]"));
          assert(result.includes("Checked"), result);
          assert(!result.includes("attention"), result);
        },
      });

      // 제품 결함: 확인하지 못한 앱 동작(unknown invocation)을 사람에게 알리고 복구 행동을
      // 안내하는 settings 자리가 없다. core가 ledger에 확인 불가로 남기는 데서 끝난다.
      await t.step({
        name:
          "platform/backup-and-migration#R16 shell/wording#R10: settings 화면이 확인하지 못한 일과 필요한 복구 행동을 보인다",
        ignore: true,
        async fn() {
          assertEquals(await again.count("[data-unconfirmed]"), 1);
        },
      });
    } finally {
      await opened?.close();
      await removeHome(home);
      await Deno.remove(pack, { recursive: true });
      await Deno.remove(install, { recursive: true });
    }
  },
});
