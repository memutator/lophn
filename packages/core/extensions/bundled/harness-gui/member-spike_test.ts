// SPIKE (not for merge): a lophn call delivered into a harness GUI session as an ACP `send` input, and the reply going back
// to the sender through the Router. Real Router (in-memory ports), real envelope rendering (`inputParts`), real Antigravity
// adapter replaying the recorded `agy acp` text fixture. No real CLI, no model.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ok } from "../../../../base/mod.ts";
import { manualClock } from "../../../../base/clock.ts";
import { createIdSource } from "../../../../base/id.ts";
import { seededRandom } from "../../../../base/random.ts";
import type { AcpInput } from "../../../../protocol/acp/input.ts";
import { EMPTY_ACP_STATE, reduceAcp } from "../../../../protocol/acp/reduce.ts";
import type { AcpState } from "../../../../protocol/acp/state.ts";
import type {
  AcpSessionHandle,
  ExtensionProcess,
} from "../../../../protocol/extensions/mod.ts";
import { textBlocks } from "../../../../protocol/lophn-agent/content-block.ts";
import type { AgentCallRow } from "../../../../protocol/lophn-agent/calls.ts";
import { DEFAULT_CALL_POLICY } from "../../../../protocol/lophn-agent/call-policy.ts";
import { lophnIdOf } from "../../../../protocol/lophn-agent/workspaces.ts";
import type { Tx } from "../../../../protocol/server/mod.ts";
import { inputParts } from "../../../lophn-agent/run-loop/input-text.ts";
import { createRouter } from "../../../router/router.ts";
import type {
  CallStore,
  RoutedInput,
  TargetSession,
} from "../../../router/ports.ts";
import { createAntigravityAdapter } from "./antigravity.ts";

type Frame = Record<string, unknown>;
type Entry = { kind: string; data: Frame };
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

// --- Router with in-memory ports (same shape as router_test.ts) ---
function router() {
  let counter = 0;
  const tx = {
    now: () => "2026-11-21T00:00:00.000Z",
    newId: (prefix: string) => `${prefix}_${++counter}`,
  } as unknown as Tx;
  const lophn = { agent: lophnIdOf(null), workspace: null } as const;
  const sessions: Record<string, TargetSession> = {
    ses_lead: {
      session: "ses_lead" as TargetSession["session"],
      transport: "lophn",
      agent: lophn,
      accepting: true,
      spawned_by: null,
    },
    // The GUI member. Today the only non-lophn transport is "harness"; the spike reuses it.
    ses_member: {
      session: "ses_member" as TargetSession["session"],
      transport: "harness",
      agent: lophn,
      accepting: true,
      spawned_by: null,
    },
  };
  const rows = new Map<string, AgentCallRow>();
  const delivered: { to: string; input: RoutedInput }[] = [];
  const store: CallStore = {
    insert: (_tx, row) => void rows.set(row.call, row) ?? ok(undefined),
    byDedup: () => null,
    read: (_tx, call) => rows.get(call) ?? null,
    move: (_tx, call, to, reason, result) => {
      const moved = {
        ...rows.get(call)!,
        state: to,
        fail_reason: reason,
        result: result ?? null,
      };
      rows.set(call, moved);
      return ok(moved);
    },
    markConsumed: () => ok(undefined),
    lost: () => [],
    openReceivedBy: () => [],
  };
  const r = createRouter({
    directory: {
      find: (session) => sessions[session] ?? null,
      resolveAddress: () => ok(lophn),
      open: () => ok(sessions.ses_member!),
      app: () => null,
      accepts: () => null,
      listOpen: () => [],
    },
    store,
    callPolicy: () => DEFAULT_CALL_POLICY,
    announce: () => {},
    transport: {
      deliver: (_tx, to, input) => {
        delivered.push({ to: to.session, input });
        return ok(undefined);
      },
      cancel: () => ok(undefined),
    },
  });
  return { tx, router: r, rows, delivered };
}

// --- Antigravity adapter on the recorded `text` fixture (same replay as antigravity_test.ts) ---
async function agy() {
  const rec: Entry[] = readFileSync(
    fileURLToPath(new URL("./fixtures/antigravity/text.jsonl", import.meta.url)),
    "utf8",
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const sendsOf = (method: string) =>
    rec.flatMap((e, at) =>
      e.kind === "send" && e.data.method === method ? [at] : [],
    );
  const written: Frame[] = [];
  const counts = new Map<string, number>();
  let cursor = 0;
  let out: (text: string) => void = () => {};
  const emit = (frame: Frame) =>
    out(`${JSON.stringify({ jsonrpc: "2.0", ...frame })}\n`);
  const ourId = (recorded: unknown) => {
    const at = rec.findIndex((e) => e.kind === "send" && e.data.id === recorded);
    const method = rec[at]?.data.method as string;
    const nth = sendsOf(method).indexOf(at);
    return written.filter((b) => b.method === method)[nth]?.id;
  };
  const replay = (e: Entry) => {
    if (e.data.method === undefined && e.data.id !== undefined) {
      const id = ourId(e.data.id);
      if (id !== undefined) emit({ ...e.data, id });
    } else emit(e.data);
  };
  const proc: ExtensionProcess = {
    pid: 1,
    write(text) {
      const body = JSON.parse(text) as Frame;
      written.push(body);
      const method = body.method as string | undefined;
      if (method === undefined || body.id === undefined) return;
      const nth = counts.get(method) ?? 0;
      counts.set(method, nth + 1);
      const at = sendsOf(method)[nth];
      if (method === "session/prompt") {
        if (at !== undefined) cursor = Math.max(cursor, at + 1);
        return;
      }
      setImmediate(() => {
        if (at === undefined) return emit({ id: body.id, result: {} });
        let next = at + 1;
        for (; rec[next]?.kind === "recv"; next += 1) replay(rec[next]!);
        cursor = Math.max(cursor, next);
      });
    },
    end() {},
    kill() {},
    onStdout: (fn) => void (out = fn),
    onStderr() {},
    onExit() {},
  };
  let state: AcpState = EMPTY_ACP_STATE;
  let input: (m: AcpInput) => void = () => {};
  const handle: AcpSessionHandle = {
    id: "win_test",
    publish: (u) => void (state = reduceAcp(state, u)),
    onInput: (fn) => void (input = fn),
    onClose() {},
    close() {},
  };
  const clock = manualClock(Date.UTC(2026, 10, 21));
  const started = await createAntigravityAdapter({
    home: "/home/test",
    readFile: () => Promise.reject(new Error("no files")),
    exists: () => Promise.resolve(false),
  }).start({
    terminal: null,
    cwd: "/work/member",
    session: handle,
    spawn: () => proc,
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
  });
  assert.equal(started.ok, true);
  for (let i = 0; i < 4; i += 1) await flush();
  return {
    written,
    get state() {
      return state;
    },
    async send(m: AcpInput) {
      input(m);
      await flush();
      await flush();
      await flush();
    },
    async playToEnd() {
      for (; cursor < rec.length; cursor += 1) {
        const e = rec[cursor];
        if (e?.kind === "recv") {
          replay(e);
          await flush();
        }
      }
    },
  };
}

test("SPIKE: a call routed to a GUI member runs as a GUI turn and its last answer replies to the sender", async () => {
  const { tx, router: r, rows, delivered } = router();

  // 1. lead sends a result call to the member session.
  const sent = r.route(tx, {
    from: { kind: "agent", session: "ses_lead" },
    to: { session: "ses_member" },
    reply: "result",
    body: textBlocks("Say hello."),
    refs: [],
    reply_to: null,
    kind: "call",
    delivery: "next_turn",
    dedup: "tool-1",
  } as never);
  assert.ok(sent.ok && sent.value.call !== null);
  const call = sent.value.call;
  const toMember = delivered.find((d) => d.to === "ses_member")!.input;

  // 2. core renders the envelope exactly as for headless harness agents and puts it into the GUI handle as an ACP send.
  const envelope = inputParts(toMember, "claude-code")
    .flatMap((p) => (p.kind === "text" ? [p.text] : []))
    .join("\n");
  assert.match(envelope, /^<lophn-call /);
  const gui = await agy();
  await gui.send({
    type: "send",
    session: "ses_member",
    id: "msg_call",
    key: "call:" + call,
    content: [{ type: "text", text: envelope }],
    delivery: "next_turn",
  } as AcpInput);

  // The harness CLI got the envelope verbatim as the prompt.
  const prompt = gui.written.find((b) => b.method === "session/prompt");
  const promptText = JSON.stringify(prompt?.params);
  assert.ok(promptText.includes("lophn-call"), promptText);

  // 3. The recorded agy answer plays; the turn that took msg_call ends.
  await gui.playToEnd();
  const taken = gui.state.items.find(
    (i) => i.kind === "message" && i.id === "msg_call",
  );
  assert.ok(taken !== undefined && taken.kind === "message");
  const turn = taken.turn;
  assert.ok(turn !== null);
  assert.equal(gui.state.turn?.id, turn);
  assert.equal(gui.state.turn?.phase, "ended");
  // FINDING: the live path draws an injected call as a person message (raw envelope). Replay classifies it as received.
  console.log("live actor of injected call:", taken.actor);

  // 4. The last agent text of that turn is the reply (same rule as custom/harness auto-reply).
  const answer = gui.state.items
    .filter(
      (i) =>
        i.kind === "message" && i.actor === "agent" && i.turn === turn,
    )
    .at(-1);
  assert.ok(answer !== undefined && answer.kind === "message");
  const text = answer.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("");
  assert.notEqual(text.trim(), "");
  console.log("auto-reply text:", JSON.stringify(text.slice(0, 120)));

  // 5. core replies as the member session; the lead gets a reply input and the call is done.
  const replied = r.reply(tx, { session: "ses_member" } as never, {
    call,
    body: textBlocks(text),
    refs: [],
  } as never);
  assert.deepEqual(replied, ok({ delivered: true, closed: false }));
  const back = delivered.find((d) => d.to === "ses_lead");
  assert.equal(back?.input.kind, "reply");
  assert.equal(back?.input.reply_to, call);
  assert.equal(rows.get(call)?.state, "done");
});
