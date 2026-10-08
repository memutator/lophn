import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { connect } from "node:net";
import { basename, dirname } from "node:path";
import { test } from "node:test";

import {
  LOPHN_TERMINAL_OBSERVE,
  observeEnvelopeSchema,
} from "../../../../../packages/contracts/coding-agent/mod.ts";
import {
  createCodingHost,
  type HostEvent,
} from "../../../terminal-host/launch-plan.ts";
import {
  createObserveSocket,
  OBSERVE_LINE_LIMIT_BYTES,
} from "../../../terminal-host/observe-socket.ts";
import {
  CAC,
  hookPayload,
  launchPlan,
  sleep,
  tempDir,
  TKT,
  until,
} from "./fixtures.ts";

function setup(ref = "term_9", generation = 3) {
  const events: HostEvent[] = [];
  const root = tempDir("observe");
  let tick = 0;
  const host = createCodingHost({
    platform: "linux",
    now: () => `2026-10-05T00:00:0${tick++ % 10}.000Z`,
    timer: () => () => {},
    emit: (event) => {
      if (event.event === "observation") events.push(event);
    },
    socketRoot: root,
  });
  const cwd = tempDir("cwd");
  const prepared = host.prepare(
    launchPlan({ executable: "/bin/true" }, cwd),
    { env: { PATH: "/usr/bin" }, checkFolder: (path) => ({ ok: true, path }) },
  );
  assert.equal(prepared.ok, true);
  if (!prepared.ok) throw new Error("not prepared");
  const attachment = host.attach(
    prepared.launch,
    { runtime_ref: ref, generation },
    () => {},
  );
  return { attachment, events, cwd, launch: prepared.launch };
}

async function send(path: string, text: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const client = connect(path);
    client.on("error", () => resolve());
    client.on("close", () => resolve());
    client.on("connect", () => client.end(text));
  });
}

const states = (events: HostEvent[]) =>
  events.map((event) => event.envelope.observation.state);

test("shell/terminal#R12: observe socket은 0700 폴더의 무작위 이름이고 끝나면 지운다", async () => {
  const first = setup();
  const second = setup("term_10", 1);
  const one = await first.attachment.begin();
  const two = await second.attachment.begin();
  assert.equal(one.ok && two.ok, true);
  if (!one.ok || !two.ok) return;
  const path = one.env[LOPHN_TERMINAL_OBSERVE] ?? "";
  assert.equal(statSync(dirname(path)).mode & 0o777, 0o700);
  assert.equal(statSync(path).isSocket(), true);
  // 이름이 TUI마다 다르고 runtime·ticket·connection을 드러내지 않는다.
  assert.notEqual(
    basename(path),
    basename(two.env[LOPHN_TERMINAL_OBSERVE] ?? ""),
  );
  assert.equal(path.includes(TKT) || path.includes(CAC), false);
  first.attachment.exited();
  assert.equal(existsSync(path), false);
  assert.equal(existsSync(dirname(path)), false);
  second.attachment.abandon();
});

test("shell/terminal#R12: 환경에는 socket 경로 하나만 더하고 상속된 다른 경로는 지운다", async () => {
  const host = createCodingHost({
    platform: "linux",
    now: () => "2026-10-05T00:00:00.000Z",
    timer: () => () => {},
    emit: () => {},
    socketRoot: tempDir("observe"),
  });
  const prepared = host.prepare(
    launchPlan({ executable: "/bin/true" }, tempDir("cwd")),
    {
      env: {
        PATH: "/usr/bin",
        [LOPHN_TERMINAL_OBSERVE]: "/tmp/inherited.sock",
        LOPHN_TOKEN: "leaked",
      },
      checkFolder: (path) => ({ ok: true, path }),
    },
  );
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.equal(prepared.launch.baseEnv[LOPHN_TERMINAL_OBSERVE], undefined);
  const attachment = host.attach(
    prepared.launch,
    { runtime_ref: "term_1", generation: 1 },
    () => {},
  );
  const begun = await attachment.begin();
  assert.equal(begun.ok, true);
  if (!begun.ok) return;
  assert.notEqual(begun.env[LOPHN_TERMINAL_OBSERVE], "/tmp/inherited.sock");
  assert.equal(begun.env.LOPHN_TOKEN, undefined);
  attachment.abandon();
});

test("shell/terminal#R12: host가 자기 runtime_ref·generation·origin·launch plan의 connection·ticket을 붙이고 payload 주장은 쓰지 않는다", async () => {
  const { attachment, events, cwd } = setup("term_9", 3);
  const begun = await attachment.begin();
  assert.equal(begun.ok, true);
  if (!begun.ok) return;
  attachment.spawned(() => {});
  const before = events.length;
  await send(
    begun.env[LOPHN_TERMINAL_OBSERVE] ?? "",
    JSON.stringify(hookPayload()) + "\n",
  );
  await until(() => events.length > before);
  const last = events[events.length - 1];
  assert.equal(last?.event, "observation");
  const envelope = observeEnvelopeSchema.parse(last?.envelope);
  assert.equal(envelope.runtime_ref, "term_9");
  assert.equal(envelope.generation, 3);
  const observation = envelope.observation;
  assert.equal(observation.origin, "lophn_terminal");
  assert.equal(observation.runtime_ref, "term_9");
  assert.equal(observation.connection, CAC);
  assert.equal(observation.ticket, TKT);
  assert.equal(observation.harness_id, "claude");
  assert.equal(observation.profile_id, null);
  assert.equal(observation.cwd, cwd);
  assert.equal(observation.environment.identity, "work");
  // 상태·증거는 hook의 것이다.
  assert.equal(observation.state, "working");
  assert.equal(observation.evidence_source, "hook");
  attachment.exited();
});

test("shell/terminal#R12: 틀린 줄·host 전용 증거·64KiB 넘는 줄은 관측이 되지 않는다", async () => {
  const { attachment, events } = setup();
  const begun = await attachment.begin();
  assert.equal(begun.ok, true);
  if (!begun.ok) return;
  attachment.spawned(() => {});
  const path = begun.env[LOPHN_TERMINAL_OBSERVE] ?? "";
  const baseline = events.length;
  await send(
    path,
    [
      "not json",
      JSON.stringify({ state: "ready" }),
      JSON.stringify(hookPayload({ evidence_source: "process" })),
      JSON.stringify(hookPayload({ evidence_source: "launch" })),
      JSON.stringify(
        hookPayload({
          evidence_ref: "x".repeat(OBSERVE_LINE_LIMIT_BYTES + 1),
        }),
      ),
    ].join("\n") + "\n",
  );
  // 줄바꿈 없이 상한을 넘기면 연결을 끊는다.
  await send(path, "y".repeat(OBSERVE_LINE_LIMIT_BYTES + 10));
  await sleep(100);
  assert.equal(events.length, baseline);
  // 뒤따르는 올바른 줄은 받는다.
  await send(path, JSON.stringify(hookPayload({ state: "ready" })) + "\n");
  await until(() => events.length > baseline);
  assert.equal(events[events.length - 1]?.envelope.observation.state, "ready");
  attachment.exited();
});

test("shell/terminal#R12: starting(launch) 뒤 첫 hook 전은 unknown이고 process exit는 ended이며 늦은 working이 되살리지 않는다", async () => {
  const { attachment, events } = setup();
  const begun = await attachment.begin();
  assert.equal(begun.ok, true);
  if (!begun.ok) return;
  assert.equal(events[0]?.envelope.observation.state, "starting");
  assert.equal(events[0]?.envelope.observation.evidence_source, "launch");
  assert.equal(events[0]?.envelope.observation.origin, "lophn_terminal");
  attachment.spawned(() => {});
  const unknown = events[1]?.envelope.observation;
  assert.equal(unknown?.state, "unknown");
  assert.notEqual(unknown?.reason, null);
  const path = begun.env[LOPHN_TERMINAL_OBSERVE] ?? "";
  await send(
    path,
    JSON.stringify(
      hookPayload({
        state: "ready",
        provider_session: {
          kind: "claude_code",
          id: "sess-1",
          source: "hook",
          acquired_at: "2026-10-05T00:00:00.000Z",
        },
      }),
    ) + "\n",
  );
  await until(() => events.length === 3);
  // ID evidence가 없는 새 관측은 지난 evidence를 지우지 않는다.
  await send(path, JSON.stringify(hookPayload({ state: "working" })) + "\n");
  await until(() => events.length === 4);
  assert.equal(
    events[3]?.envelope.observation.provider_session?.id,
    "sess-1",
  );
  attachment.exited();
  const ended = events[4]?.envelope.observation;
  assert.equal(ended?.state, "ended");
  assert.equal(ended?.evidence_source, "process");
  assert.equal(ended?.provider_session?.id, "sess-1");
  // socket은 지워졌으니 늦은 hook은 닿지 못하고 관측은 더 늘지 않는다.
  await send(path, JSON.stringify(hookPayload({ state: "working" })) + "\n");
  await sleep(50);
  assert.deepEqual(states(events), [
    "starting",
    "unknown",
    "ready",
    "working",
    "ended",
  ]);
});

test("shell/terminal#R12: 종료를 확인하지 못하거나 수집이 끊기면 unknown으로 남고 socket을 지운다", async () => {
  const { attachment, events } = setup();
  const begun = await attachment.begin();
  assert.equal(begun.ok, true);
  if (!begun.ok) return;
  attachment.spawned(() => {});
  const path = begun.env[LOPHN_TERMINAL_OBSERVE] ?? "";
  attachment.lost("종료를 확인하지 못했다");
  const last = events[events.length - 1]?.envelope.observation;
  assert.equal(last?.state, "unknown");
  assert.equal(last?.reason, "종료를 확인하지 못했다");
  assert.equal(existsSync(path), false);
});

test("shell/terminal#R12: Windows는 폴더 없이 무작위 named pipe 이름을 쓴다", () => {
  const socket = createObserveSocket({
    platform: "win32",
    runtime_ref: "term_1",
    generation: 1,
    stamp: () => null,
    accept: () => {},
    random: () => "abc123",
  });
  assert.equal(socket.path, "\\\\.\\pipe\\lophn-observe-abc123");
  socket.close();
});
