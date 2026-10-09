// flow update-lophn 1·2·3단계(docs/flows/update-lophn.md). 실제 ~/.lophn은 열지 않는다.
// 1·2단계는 실제 shell(headless)과 core를 임시 LOPHN_HOME으로 띄운다.
// 1단계: settings에서 이 OS의 설치 패키지를 확인하고 사람이 고른 로컬 metadata로 수동 update를
// 고른다. 자동 다운로드·자동 설치·사용 중 재시작은 없고, 검증하지 않은 배포를 사용 가능한
// 완료로 안내하지 않는다.
// 2단계: 정상 정지 뒤 그 패키지 파일로 설치 파일만 바꾼다. 데이터 폴더의 ledger는 남는다.
// 3단계: schema가 뒤처져 있으면 화면 없이 제품 core만 다시 띄운다. 새 command는 migration이
// 끝나기 전에 받지 않고, 이미 끝난 짧은 쓰기와 데이터 폴더는 남긴다. 검증 backup 뒤에
// 포함된 단계를 순서대로 적용하고, 실패한 단계는 rollback한 뒤 다음 기동이 그 단계부터
// 다시 한다.
// 4–8단계는 보지 않는다.
import { assert, assertEquals, assertThrows } from "@std/assert";
import { type ChildProcess, spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

import { sha256Hex } from "../../packages/base/mod.ts";
import {
  encodeFrame,
  FrameDecoder,
  type MainHello,
  mainHelloSchema,
  mainToCoreMessageSchema,
} from "../../packages/contracts/platform/mod.ts";
import { RECOVERY_STAMP } from "../../packages/platform/backup-and-migration/mod.ts";
import { SECRET_SCHEMA_STEPS } from "../../packages/platform/secrets/mod.ts";
import { SETTINGS_SCHEMA_STEPS } from "../../packages/platform/settings/mod.ts";
import { coreLaunch } from "../../apps/shell/main/desktop/core/supervise.ts";
import { e2eEnabled } from "../harness.ts";
import {
  type FlowShell,
  mustCall,
  openFlowShell,
  removeHome,
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

function bootCore(home: string, sessionHome: string): Boot {
  const port = freePort();
  const launch = coreLaunch({
    repoRoot: UPDATE_REPO,
    dataRoot: home,
    denoBinary: Deno.execPath(),
    packaged: false,
    port,
    env: { HOME: sessionHome },
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
