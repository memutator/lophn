import { textBlocks } from "../../protocol/lophn-agent/content-block.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { err, ok } from "../../base/mod.ts";
import type { AgentCallRow } from "../../protocol/lophn-agent/calls.ts";
import { DEFAULT_CALL_POLICY } from "../../protocol/lophn-agent/call-policy.ts";
import type { CommandDefinition, Tx } from "../../protocol/server/mod.ts";
import { ROUTER_COMMANDS } from "./commands.ts";
import { installRouterEnvironment } from "./environment.ts";
import type { RoutedInput, TargetSession } from "./ports.ts";

// 권한 경계다. call과 답의 unattended 표시는 보낸 쪽 입력이 아니라 core가 credential의 turn mode에서 찍는다.
// 표시가 빠지면 사람 없이 도는 사슬이 attended로 새어 shell `ask`에 멈춘다.

const id = (prefix: string, n: number) =>
  `${prefix}_${String(n).padStart(26, "0")}`;
const SENDER = id("ses", 1);
const RECEIVER = id("ses", 2);
const MODES: Record<string, string> = {
  [id("trn", 1)]: "attended",
  [id("trn", 2)]: "unattended",
  [id("trn", 3)]: "skip",
};

function world() {
  let counter = 0;
  const rows = new Map<string, AgentCallRow>();
  const delivered: RoutedInput[] = [];
  const target = (session: string): TargetSession => ({
    session: session as TargetSession["session"],
    transport: "lophn",
    agent: { agent: "lophn_home", workspace: null },
    accepting: true,
    open: true,
    spawned_by: null,
    opened_by_machine: null,
    runs_on: null,
  });
  installRouterEnvironment({
    unattendedTurn: (_view, turn) => MODES[turn] === "unattended",
    deps: () => ({
      callPolicy: () => DEFAULT_CALL_POLICY,
      announce: () => {},
      directory: {
        find: (session) => target(session),
        resolveAddress: () => ok({ agent: "lophn_home", workspace: null }),
        archive: () => ok(false),
        membersOn: () => [],
        membersFrom: () => [],
        membersUnder: () => [],
        setWorkflowOrigin: () => {},
        openMember: () =>
          err({ code: "forbidden", message: "not in this test" }),
        open: () => ok(target(RECEIVER)),
        app: () => null,
        accepts: () => null,
        listOpen: () => [],
        projectOfIdentity: () => null,
        identityOfProject: () => ok("pri_test"),
        appIdOf: () => err({ code: "not_found", message: "app not found" }),
      },
      outbox: {} as never,
      seen: {} as never,
      self: () => "mch_self",
      steps: {} as never,
      transport: {
        deliver: (_tx, _to, input) => {
          delivered.push(input);
          return ok(undefined);
        },
        cancel: () => ok(undefined),
        withdraw: () => ok(undefined),
      },
      store: {
        insert: (_tx, record) => {
          rows.set(record.call, record);
          return ok(undefined);
        },
        byDedup: (_tx, sender, dedup) =>
          [...rows.values()].find(
            (row) =>
              row.from.kind === "agent" &&
              sender.kind === "agent" &&
              row.from.session === sender.session &&
              row.dedup === dedup,
          ) ?? null,
        read: (_tx, call) => rows.get(call) ?? null,
        memberCall: () => null,
        move: (_tx, call, to, reason) => {
          const moved = { ...rows.get(call)!, state: to, fail_reason: reason };
          rows.set(call, moved);
          return ok(moved);
        },
        consumed: () => true,
        markConsumed: () => ok(undefined),
        setDelivery: () => ok(undefined),
        lost: () => [],
        openReceivedBy: () => [],
        openAsksSentBy: () => [],
        openSentFromRemote: () => [],
      },
    }),
  });
  const tx = {
    now: () => "2026-11-01T00:00:00.000Z",
    newId: (prefix: string) => id(prefix, 100 + ++counter),
    port: () => ({ principal: () => "agent" }),
  } as unknown as Tx;
  return { tx, rows, delivered };
}

function handle(method: string) {
  return ROUTER_COMMANDS.find(
    (command) => command.route.method === method,
  ) as unknown as CommandDefinition;
}

const as = (session: string, turn: string) =>
  ({ actor: `agent:${session}`, turn }) as never;

test("calls.send and calls.reply stamp unattended from the turn mode of the caller", () => {
  for (const [turn, mode] of Object.entries(MODES)) {
    const { tx, rows, delivered } = world();
    const sent = handle("send").handle(
      tx,
      as(SENDER, turn),
      {
        to: { agent: "lophn" },
        reply: "result",
        body: textBlocks("do it"),
        refs: [],
        dedup: "tool-1",
      },
      {},
    );
    assert.ok(sent.ok);
    const call = (sent.value as { call: string }).call;
    assert.deepStrictEqual(
      [delivered.at(-1)!.unattended, rows.get(call)!.unattended],
      [mode === "unattended", mode === "unattended"],
    );
    const replied = handle("reply").handle(
      tx,
      as(RECEIVER, turn),
      {
        call,
        body: textBlocks("done"),
        refs: [],
      },
      {},
    );
    assert.ok(replied.ok);
    assert.deepStrictEqual(delivered.at(-1)!.unattended, mode === "unattended");
  }
});
