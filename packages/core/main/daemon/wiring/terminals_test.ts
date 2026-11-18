import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import {
  createIdSource,
  cryptoRandom,
  manualClock,
  ok,
  systemClock,
} from "../../../../base/mod.ts";
import { routePath } from "../../../../protocol/base/mod.ts";
import {
  TERMINAL_ROUTES,
  type TerminalOutput,
  terminalsInput,
  terminalsRestart,
  terminalsSnapshot,
  terminalsWatch,
} from "../../../../protocol/coding-agent/terminals.ts";
import type { BusEvent } from "../../../../protocol/events/bus.ts";
import { dispatchHttp } from "../../../server/dispatch.ts";
import type { MemoryHandler, ReadHandler } from "../../../server/mod.ts";
import type { PtyAdapter } from "../../../terminals/host/pty.ts";
import { serveHost } from "../../../terminals/host/serve.ts";
import { createTerminals } from "../../../terminals/mod.ts";
import { terminalsWiring } from "./terminals.ts";

const PROJECT = `prj_${"0".repeat(26)}`;
const CAPABILITY = "c".repeat(43);

// node-pty 대신 쓰는 PTY. 친 글을 모으고, 테스트가 출력을 낸다. group은 kill하면 죽는다.
function fakePty() {
  const alive = new Set<number>();
  const written: string[] = [];
  const outputs: ((chunk: string) => void)[] = [];
  let pid = 100;
  const pty: PtyAdapter = {
    spawn() {
      const id = pid++;
      alive.add(id);
      return {
        pid: id,
        write: (data) => void written.push(data),
        resize() {},
        kill() {},
        onData(listener) {
          outputs.push(listener);
          return { dispose() {} };
        },
        onExit: () => ({ dispose() {} }),
        foreground: () => null,
      };
    },
    group: (group) => ({
      pid: group,
      kill() {
        alive.delete(group);
        return { confirmed: true };
      },
      alive: () => alive.has(group),
    }),
  };
  return {
    pty,
    alive,
    written,
    emit: (chunk: string) => outputs.at(-1)!(chunk),
  };
}

// PTY host를 subprocess 없이 같은 process에서 돌린다. supervisor는 진짜 host와 같은 pipe 줄로 말한다.
function inProcessHost(pty: PtyAdapter) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const proc = Object.assign(new EventEmitter(), {
    stdin: {
      write: (data: string) => stdin.write(data),
      end: () => stdin.end(),
      on() {},
    },
    stdout,
    stderr: new EventEmitter(),
    killed: false,
    kill: () => true,
  });
  serveHost({
    deps: {
      pty,
      ids: createIdSource({ clock: systemClock, random: cryptoRandom }),
      env: { SHELL: "/bin/sh" },
      platform: "linux",
      exists: () => true,
      checkFolder: (path) => ({ ok: true, path }),
      schedule: (done) => setImmediate(done),
      sleep: async () => {},
    },
    input: stdin,
    write: (line) => stdout.write(`${JSON.stringify(line)}\n`),
    exit: (code) => proc.emit("exit", code, null),
  });
  return proc;
}

async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !done(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(done(), "condition was not met in time");
}

async function setup() {
  const fake = fakePty();
  const clock = manualClock(Date.parse("2026-11-18T00:00:00.000Z"));
  const published: BusEvent[] = [];
  const terminals = createTerminals({
    spawnHost: () => inProcessHost(fake.pty),
    personEnv: { cli: null, env: async () => ({ SHELL: "/bin/sh" }) },
    folders: async (project) =>
      ok([{ folder_ref: `${project}_0`, path: tmpdir() }]),
    platform: "linux",
    hostExited() {},
  });
  const slots: Record<string, unknown> = {
    terminals,
    // 기기 dev_b만 허락받았다. 살아 있는 capability는 하나다.
    terminalInputGrant: (principal: string) => principal === "device:dev_b",
    shellCapabilities: { has: (value: string) => value === CAPABILITY },
  };
  const ctx = {
    clock,
    peek: slots,
    terminals,
    bus: { publish: (event: BusEvent) => published.push(event) },
    hostQueue: { openTab() {} },
  };
  const wiring = terminalsWiring();
  const built = await wiring.build!(ctx as never);
  assert.ok(built.ok);
  const memory = new Map(
    built.value.memory as Iterable<[string, MemoryHandler]>,
  );
  const reads = new Map<string, ReadHandler>();
  built.value.reads!(reads);
  const opened = await terminals.open({ project: PROJECT as never });
  assert.ok(opened.ok);
  const terminal = opened.value.terminal_ref;

  const call = async (
    route: (typeof TERMINAL_ROUTES)[number],
    actor: string,
    principal: string,
    body: Record<string, unknown>,
  ) => {
    const done = await dispatchHttp(
      new Request(`http://127.0.0.1${routePath(route)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { route, path: routePath(route) },
      {
        principal,
        actor,
        scope: {
          operations: TERMINAL_ROUTES.map((one) => one.name),
          targets: {},
        },
        conditions: {},
        credential_ref: principal,
      },
      {
        credentials: undefined as never,
        clock,
        memory,
        reads,
        bodyTimeoutMs: 1000,
        jsonMaxBytes: 65_536,
      },
    );
    return done as {
      status: number;
      json: { error?: { code: string } } & Record<string, unknown>;
    };
  };
  return { fake, clock, published, terminals, terminal, wiring, call };
}

test("agent 자격과 터미널 입력 허락이 없는 기기는 터미널에 치지 못한다", async () => {
  const { fake, terminal, wiring, call } = await setup();
  const refused: [string, string, Record<string, unknown>][] = [
    ["agent:ses_x", "agent:ses_x", { shell_capability: CAPABILITY }],
    ["user", "device:dev_a", {}],
    ["user", "user", {}],
    ["user", "user", { shell_capability: "x".repeat(43) }],
  ];
  for (const [actor, principal, extra] of refused) {
    const done = await call(terminalsInput, actor, principal, {
      terminal,
      text: `${principal}\n`,
      ...extra,
    });
    assert.equal(done.json.error?.code, "forbidden", principal);
  }
  assert.deepEqual(fake.written, []);

  const device = await call(terminalsInput, "user", "device:dev_b", {
    terminal,
    text: "from phone\n",
  });
  const shell = await call(terminalsInput, "user", "user", {
    terminal,
    text: "from desktop\n",
    shell_capability: CAPABILITY,
  });
  assert.equal(device.status, 200);
  assert.equal(shell.status, 200);
  assert.deepEqual(fake.written, ["from phone\n", "from desktop\n"]);

  const restart = await call(terminalsRestart, "user", "user", {
    terminal,
    generation: 1,
    shell_capability: "x".repeat(43),
  });
  assert.equal(restart.json.error?.code, "forbidden");
  await wiring.closeWork!();
});

test("core가 끝나면 PTY가 남지 않는다", async () => {
  const { fake, terminals, wiring } = await setup();
  const second = await terminals.open({ project: PROJECT as never });
  assert.ok(second.ok);
  assert.equal(fake.alive.size, 2);
  // closeWork가 host stdin을 닫고, host는 stdin EOF에 모든 PTY를 끝낸 뒤 끝난다.
  await wiring.closeWork!();
  assert.equal(fake.alive.size, 0);
});

test("화면이 다시 붙어도 터미널의 출력을 잃거나 두 번 받지 않는다", async () => {
  const { fake, clock, published, terminals, terminal, wiring, call } =
    await setup();
  let seen = 0;
  terminals.onOutput((output) => {
    for (const chunk of output) seen = Math.max(seen, chunk.seq);
  });
  const emit = async (text: string) => {
    const before = seen;
    fake.emit(text);
    await until(() => seen > before);
  };
  const appended = () =>
    published
      .filter((event) => event.type === "TerminalOutputAppended")
      .map((event) => event.payload as TerminalOutput);

  // 붙는 쪽: watch → snapshot{after_seq} → 받은 seq보다 큰 event만 쓴다. seq가 건너뛰면 snapshot으로 다시 맞춘다.
  const used: { seq: number; from: "snapshot" | "event"; text: string }[] = [];
  let last = 0;
  let read = 0;
  const watch = () =>
    call(terminalsWatch, "user", "user", { terminal, watcher: "w", on: true });
  const resync = async () => {
    const snap = await call(terminalsSnapshot, "user", "user", {
      terminal,
      after_seq: last,
    });
    for (const chunk of snap.json.output as TerminalOutput[]) {
      used.push({ seq: chunk.seq, from: "snapshot", text: chunk.chunk });
      last = chunk.seq;
    }
  };
  const drain = async () => {
    for (const event of appended().slice(read)) {
      read++;
      if (event.seq <= last) continue;
      if (event.seq !== last + 1) {
        await resync();
        continue;
      }
      used.push({ seq: event.seq, from: "event", text: event.chunk });
      last = event.seq;
    }
  };

  await emit("a");
  assert.deepEqual(appended(), []);
  await watch();
  await resync();
  await emit("b");
  await emit("c");
  await drain();
  // lease를 놓쳤다. 그 사이 출력은 Bus에 가지 않는다.
  clock.advance(30_000);
  await emit("d");
  await watch();
  await emit("e");
  await drain();
  await emit("f");
  await drain();

  assert.deepEqual(
    appended().map((event) => event.seq),
    [2, 3, 5, 6],
  );
  assert.deepEqual(
    used.map((one) => `${one.from}:${one.seq}`),
    ["snapshot:1", "event:2", "event:3", "snapshot:5", "event:6"],
  );
  assert.match(used[3]!.text, /abcde/);
  await wiring.closeWork!();
});
