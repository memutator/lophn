// TUI 아래 MCP·CLI process 관측 시험(platform#T34 후속, shell/terminal#R5, platform/identity#R15). process table은
// fake라 실제 coding agent 제품·core·keychain은 열지 않는다. 마지막 시험만 실제 /proc을 읽는다.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  type ChildEvent,
  createChildWatch,
  isInstalledLoaderChild,
  type ProcessEntry,
  type ProcessIdentity,
  type ProcessTree,
  procTree,
} from "../../../terminal-host/child-watch.ts";
import {
  createCodingHost,
  type HostEvent,
} from "../../../terminal-host/launch-plan.ts";
import { CAC, launchPlan, tempDir } from "./fixtures.ts";

const HELPER = "/opt/lophn/lophn-credential";
const ROOT = "/opt/lophn";
const MCP_ARGV = [
  `${ROOT}/deno`,
  "run",
  "--cached-only",
  "--frozen",
  "--no-prompt",
  `--config=${ROOT}/platform/deno.json`,
  `--allow-read=${ROOT}/platform,/proc/self/stat`,
  "--allow-env=LOPHN_HOME,LOPHN_CONNECTION",
  "--allow-net=127.0.0.1,[::1]",
  `--allow-run=${ROOT}/lophn-credential`,
  `${ROOT}/platform/apps/mcp/main.ts`,
];
const CLI_ARGV = [
  ...MCP_ARGV.slice(0, -1),
  `${ROOT}/platform/apps/cli/main.ts`,
  "ticket",
  "list",
];

type Fake = {
  pid: number;
  ppid: number;
  ticks: string;
  exe?: string;
  argv?: string[];
};

/** 시험이 process를 더하고 지우는 fake process table이다. */
function fakeTree(initial: Fake[]) {
  const table = new Map<number, Fake>(initial.map((p) => [p.pid, p]));
  const tree: ProcessTree = {
    entries() {
      return new Map<number, ProcessEntry>(
        [...table.values()].map((
          p,
        ) => [p.pid, { ppid: p.ppid, start_ticks: p.ticks }]),
      );
    },
    identity(pid): ProcessIdentity | undefined {
      const p = table.get(pid);
      return p === undefined ? undefined : { exe: p.exe, argv: p.argv ?? [] };
    },
  };
  return { table, tree };
}

const names = (list: readonly ChildEvent[]) => list.map((e) => e.event);

function watch(tree: ProcessTree, events: ChildEvent[], root = 100) {
  return createChildWatch({
    tree,
    root,
    runtime_ref: "term_1",
    connection: CAC,
    loader: HELPER,
    emit: (event) => events.push(event),
  });
}

test("shell/terminal#R5 platform/identity#R15: TUI의 자손인 설치 MCP·CLI process를 process generation과 loader identity로 알리고 사라지면 끝났다고 알린다", () => {
  const { table, tree } = fakeTree([
    { pid: 100, ppid: 1, ticks: "500" }, // TUI
    { pid: 110, ppid: 100, ticks: "510" }, // TUI의 harness 쪽 중간 process
  ]);
  const events: ChildEvent[] = [];
  const w = watch(tree, events);
  w.poll();
  assert.deepEqual(events, []);
  // 중간 process 아래 손자 MCP와 CLI가 뜬다(깊은 자손도 본다).
  table.set(120, {
    pid: 120,
    ppid: 110,
    ticks: "520",
    exe: `${ROOT}/deno`,
    argv: MCP_ARGV,
  });
  table.set(121, {
    pid: 121,
    ppid: 120,
    ticks: "521",
    exe: `${ROOT}/deno`,
    argv: CLI_ARGV,
  });
  w.poll();
  w.poll(); // 같은 process는 다시 알리지 않는다.
  assert.deepEqual(events, [
    {
      event: "child_started",
      runtime_ref: "term_1",
      connection: CAC,
      process_generation: "120.520",
      loader_identity: HELPER,
    },
    {
      event: "child_started",
      runtime_ref: "term_1",
      connection: CAC,
      process_generation: "121.521",
      loader_identity: HELPER,
    },
  ]);
  events.length = 0;
  table.delete(121);
  w.poll();
  assert.deepEqual(events, [{
    event: "child_ended",
    runtime_ref: "term_1",
    connection: CAC,
    process_generation: "121.521",
  }]);
  // pid가 재사용돼 시작 tick이 바뀌면 이전 generation은 끝났고 새 process는 새 generation으로 본다.
  events.length = 0;
  table.set(120, { ...table.get(120)!, ticks: "999" });
  w.poll();
  assert.deepEqual(names(events), [
    "child_ended",
    "child_started",
  ]);
  assert.equal(
    (events[1] as { process_generation: string }).process_generation,
    "120.999",
  );
});

test("shell/terminal#R5 platform/identity#R15: TUI의 자손이 아니거나 설치된 모양과 다른 process는 등록하지 않는다", () => {
  const { tree } = fakeTree([
    { pid: 100, ppid: 1, ticks: "500" }, // 이 TUI
    { pid: 200, ppid: 1, ticks: "600" }, // 다른 TUI
    { pid: 300, ppid: 200, ticks: "610", exe: `${ROOT}/deno`, argv: MCP_ARGV },
    // 같은 모양이지만 부모 사슬이 이 TUI에 닿지 않는 process(일반 shell 아래·고아)
    { pid: 301, ppid: 1, ticks: "611", exe: `${ROOT}/deno`, argv: MCP_ARGV },
    { pid: 302, ppid: 9999, ticks: "612", exe: `${ROOT}/deno`, argv: MCP_ARGV },
    // 이 TUI 아래이지만 모양이 다른 process들
    { pid: 400, ppid: 100, ticks: "700", exe: "/usr/bin/node", argv: ["node"] },
    {
      pid: 401,
      ppid: 100,
      ticks: "701",
      exe: "/usr/local/bin/deno",
      argv: MCP_ARGV,
    },
    {
      pid: 402,
      ppid: 100,
      ticks: "702",
      exe: `${ROOT}/deno`,
      argv: ["x", "run", "/tmp/evil.ts", `${ROOT}/platform/apps/mcp/main.ts`],
    },
    {
      pid: 403,
      ppid: 100,
      ticks: "703",
      exe: `${ROOT}/deno`,
      argv: [
        ...MCP_ARGV.slice(0, 5),
        "--config=/tmp/evil/deno.json",
        ...MCP_ARGV.slice(6),
      ],
    },
    {
      pid: 404,
      ppid: 100,
      ticks: "704",
      exe: `${ROOT}/deno`,
      argv: [
        ...MCP_ARGV.slice(0, 5),
        "--import-map=/tmp/m.json",
        ...MCP_ARGV.slice(6),
      ],
    },
    {
      pid: 405,
      ppid: 100,
      ticks: "705",
      exe: `${ROOT}/deno`,
      argv: [...MCP_ARGV.slice(0, 5), "-A", ...MCP_ARGV.slice(6)],
    },
    {
      pid: 406,
      ppid: 100,
      ticks: "706",
      exe: `${ROOT}/deno`,
      argv: [...MCP_ARGV.slice(0, -1), `${ROOT}/platform/apps/cli/launch.ts`],
    },
    { pid: 407, ppid: 100, ticks: "707" }, // exe를 읽지 못한 process
  ]);
  const events: ChildEvent[] = [];
  const w = watch(tree, events);
  w.poll();
  assert.deepEqual(events, []);
  // 다른 TUI를 root로 보는 watch는 그 TUI 아래 process를 그 TUI의 것으로만 본다.
  const other: ChildEvent[] = [];
  watch(tree, other, 200).poll();
  assert.deepEqual(other.map((e) => e.event), ["child_started"]);
  assert.equal(
    (other[0] as { process_generation: string }).process_generation,
    "300.610",
  );
});

test("shell/terminal#R5 platform/identity#R15: launcher shell이 exec로 deno가 되는 같은 pid도 모양이 맞는 순간 등록한다", () => {
  const { table, tree } = fakeTree([
    { pid: 100, ppid: 1, ticks: "500" },
    {
      pid: 130,
      ppid: 100,
      ticks: "530",
      exe: "/bin/sh",
      argv: ["/bin/sh", "/usr/bin/lophn-mcp"],
    },
  ]);
  const events: ChildEvent[] = [];
  const w = watch(tree, events);
  w.poll();
  assert.deepEqual(events, []);
  table.set(130, {
    pid: 130,
    ppid: 100,
    ticks: "530",
    exe: `${ROOT}/deno`,
    argv: MCP_ARGV,
  });
  w.poll();
  assert.deepEqual(names(events), ["child_started"]);
  assert.equal(
    (events[0] as { process_generation: string }).process_generation,
    "130.530",
  );
});

test("shell/terminal#R5 platform/identity#R15: TUI가 사라지면 남은 child를 모두 끝내고 TUI 종료를 한 번만 알린다", () => {
  const { table, tree } = fakeTree([
    { pid: 100, ppid: 1, ticks: "500" },
    { pid: 120, ppid: 100, ticks: "520", exe: `${ROOT}/deno`, argv: MCP_ARGV },
  ]);
  const events: ChildEvent[] = [];
  const w = watch(tree, events);
  w.poll();
  events.length = 0;
  table.delete(100);
  w.poll();
  w.poll();
  w.stop();
  assert.deepEqual(events, [
    {
      event: "child_ended",
      runtime_ref: "term_1",
      connection: CAC,
      process_generation: "120.520",
    },
    { event: "tui_ended", runtime_ref: "term_1", connection: CAC },
  ]);
});

test("shell/terminal#R5: 설치된 lophn MCP·CLI 모양 검사는 launcher의 flag와 entry만 받는다", () => {
  const ok = (argv: string[], exe = `${ROOT}/deno`) =>
    isInstalledLoaderChild({ exe, argv }, HELPER);
  assert.equal(ok(MCP_ARGV), true);
  assert.equal(ok(CLI_ARGV), true);
  assert.equal(ok(MCP_ARGV, "/tmp/deno"), false);
  assert.equal(ok([]), false);
  assert.equal(ok(["deno", "eval", "1"]), false);
  assert.equal(ok(["deno", "run", "--no-prompt"]), false);
  // 다른 설치 root의 helper로는 이 root의 process가 아니다.
  assert.equal(
    isInstalledLoaderChild(
      { exe: `${ROOT}/deno`, argv: MCP_ARGV },
      "/opt/other/lophn-credential",
    ),
    false,
  );
});

test("shell/terminal#R5 platform/identity#R15: host는 spawn한 TUI의 pid로 관측을 시작하고 TUI가 끝나면 child와 TUI 종료를 main에 보낸다", () => {
  const { table, tree } = fakeTree([
    { pid: 100, ppid: 1, ticks: "500" },
    { pid: 120, ppid: 100, ticks: "520", exe: `${ROOT}/deno`, argv: MCP_ARGV },
  ]);
  const events: HostEvent[] = [];
  let poll: (() => void) | undefined;
  let cancelled = 0;
  const host = createCodingHost({
    platform: "linux",
    now: () => "2026-10-05T00:00:00.000Z",
    timer: () => () => {},
    emit: (event) => events.push(event),
    socketRoot: tempDir("child-watch-socket"),
    watch: {
      tree,
      every: (_ms, fire) => {
        poll = fire;
        return () => cancelled++;
      },
    },
  });
  const prepared = host.prepare(
    launchPlan({ executable: "/bin/true" }, tempDir("cwd")),
    {
      env: { PATH: "/usr/bin" },
      credential_helper: HELPER,
      checkFolder: (path) => ({ ok: true, path }),
    },
  );
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const attachment = host.attach(
    prepared.launch,
    { runtime_ref: "term_1", generation: 1 },
    () => {},
  );
  attachment.spawned(() => {}, 100);
  assert.ok(poll);
  poll();
  const children = () =>
    events.filter((event) => event.event !== "observation");
  assert.deepEqual(children().map((e) => e.event), ["child_started"]);
  table.delete(100);
  attachment.exited();
  assert.deepEqual(children().map((e) => e.event), [
    "child_started",
    "child_ended",
    "tui_ended",
  ]);
  assert.equal(cancelled, 1);
  // 끝난 뒤의 훑기는 아무것도 더하지 않는다.
  poll();
  assert.equal(children().length, 3);
});

test("shell/terminal#R5: helper 경로를 받지 못했거나 절대 경로가 아니면 관측하지 않는다(그 child는 token을 받지 못한다)", () => {
  const { tree } = fakeTree([{ pid: 100, ppid: 1, ticks: "500" }]);
  for (const credential_helper of [undefined, "lophn-credential"]) {
    let started = 0;
    const host = createCodingHost({
      platform: "linux",
      now: () => "2026-10-05T00:00:00.000Z",
      timer: () => () => {},
      emit: () => {},
      socketRoot: tempDir("child-watch-socket"),
      watch: {
        tree,
        every: () => {
          started++;
          return () => {};
        },
      },
    });
    const prepared = host.prepare(
      launchPlan({ executable: "/bin/true" }, tempDir("cwd")),
      {
        env: { PATH: "/usr/bin" },
        credential_helper,
        checkFolder: (path) => ({ ok: true, path }),
      },
    );
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    host.attach(
      prepared.launch,
      { runtime_ref: "term_1", generation: 1 },
      () => {},
    )
      .spawned(() => {}, 100);
    assert.equal(started, 0);
  }
});

test("shell/terminal#R5 platform/identity#R15: 실제 /proc의 process는 부모와 시작 tick으로 보이고 process generation은 helper가 쓰는 값과 같다", async () => {
  if (process.platform !== "linux") return;
  const child = spawn("sleep", ["30"], { stdio: "ignore" });
  try {
    const pid = child.pid!;
    const tree = procTree();
    const entry = tree.entries().get(pid);
    assert.ok(entry);
    assert.equal(entry.ppid, process.pid);
    // 같은 값을 /proc/<pid>/stat에서 따로 읽는다(coding-agent/connection/credential/helper.ts의 규칙).
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    assert.equal(entry.start_ticks, rest[19]);
    const identity = tree.identity(pid);
    assert.ok(identity);
    assert.equal(identity.argv.length, 2);
    assert.equal(identity.argv[1], "30");
    assert.equal(typeof identity.exe, "string");
    assert.equal(procTree("darwin").entries().size, 0);
  } finally {
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
  }
});
