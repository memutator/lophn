import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  err,
  manualClock,
  ok,
  type Result,
  seededRandom,
} from "../../../../base/mod.ts";
import {
  type AcpInput,
  acpSend,
  type AcpUpdate,
  EMPTY_ACP_STATE,
  reduceAcp,
} from "../../../../protocol/acp/mod.ts";
import type { BusEvent } from "../../../../protocol/events/mod.ts";
import { workspaceSessionRead } from "../../../../protocol/lophn-agent/agent-sessions.ts";
import {
  contentOfBlocks,
  editQueuedMessage,
  messageBody,
  moveQueuedMessage,
  receivedMessageList,
  rewindList,
  toolCallList,
  turnList,
} from "../../../../protocol/lophn-agent/mod.ts";
import { sessionRewindPreview } from "../../../../protocol/lophn-agent/session-rewinds.ts";
import { turnRead } from "../../../../protocol/lophn-agent/turn-reads.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import {
  type CommandEnvelope,
  openConnection,
  type Writer,
} from "../../../storage/ledger/mod.ts";
import { acpWiring } from "./acp.ts";
import { checkCodingInputScope, createAcpSend } from "./acp-send.ts";
import type { WiringContext } from "./context.ts";

const SES = "ses_01h455vb4pex5v6nkc6gd5f001";
const MSG = "msg_01h455vb4pex5v6nkc6gd5f001";
const TURN = "trn_01h455vb4pex5v6nkc6gd5f001";
const PVD = "pvd_01h455vb4pex5v6nkc6gd5f001";

const person = (operations: string[]): AuthenticatedContext => ({
  principal: "user:me",
  actor: "user",
  scope: { operations, targets: {} },
  conditions: {},
  credential_ref: "user:me",
});

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

// route가 읽는 값. 각 read는 자기 operation 이름의 scope가 있어야 통과한다.
const READS: Record<string, { name: string; value: unknown }> = {
  [key(turnRead)]: {
    name: turnRead.name,
    value: { turn: { state_seq: 1, input_message: MSG } },
  },
  [key(workspaceSessionRead)]: {
    name: workspaceSessionRead.name,
    value: { session: { state_seq: 1 } },
  },
  [key(receivedMessageList)]: {
    name: receivedMessageList.name,
    value: { messages: [{ id: MSG, created_seq: "1" }], next_cursor: null },
  },
  [key(sessionRewindPreview)]: {
    name: sessionRewindPreview.name,
    value: { preview_hash: "a".repeat(64) },
  },
};

// 지금 route들처럼 부른 사람의 scope에 operation이 있어야 통과한다. 누가 불렀는지도 적는다.
function setup(
  mayLabel: (who: AuthenticatedContext, app: string) => boolean = () => true,
) {
  const callers: string[] = [];
  const envelopes: { input: unknown }[] = [];
  const ran: string[] = [];
  const allow = (who: AuthenticatedContext, name: string): Result<void> =>
    who.scope.operations.includes(name)
      ? ok(undefined)
      : err({ code: "forbidden", message: "operation forbidden" });
  const send = createAcpSend({
    command: (who, envelope) => {
      callers.push(who.principal);
      envelopes.push(envelope);
      const allowed = allow(who, envelope.command);
      return Promise.resolve(allowed.ok ? ok({ result: {} }) : allowed);
    },
    read: (who, route) => {
      callers.push(who.principal);
      const read = READS[key(route)]!;
      const allowed = allow(who, read.name);
      return Promise.resolve(allowed.ok ? ok(read.value) : allowed);
    },
    memory: () => Promise.resolve(ok({})),
    newId: (prefix) => `${prefix}_01h455vb4pex5v6nkc6gd5f009`,
    mayLabel,
    shell: {
      folderOf: () => "/work",
      env: () => ({}),
      run: (input) => {
        ran.push(input.command);
        return Promise.resolve(
          ok({
            exit_code: 0,
            timed_out: false,
            stopped: false,
            stdout: "",
            stderr: "",
            stdout_truncated: false,
            stderr_truncated: false,
          }),
        );
      },
      nowMs: () => 0,
    },
  });
  return { send, callers, ran, envelopes };
}

test("AcpSend dispatches with the caller's own scope, so a caller without the route's scope is forbidden", async () => {
  const { send, callers } = setup();
  const message: AcpInput = {
    type: "send",
    session: SES,
    id: MSG,
    key: "k1",
    content: [{ type: "text", text: "hi" }],
    delivery: "next_turn",
  } as AcpInput;
  const stop: AcpInput = {
    type: "stop",
    session: SES,
    turn: TURN,
    key: "k2",
  } as AcpInput;

  const noSend = await send(person(["ReadTurn"]), message);
  assert.equal(!noSend.ok && noSend.error.code, "forbidden");
  const noStop = await send(person(["ReadTurn"]), stop);
  assert.equal(!noStop.ok && noStop.error.code, "forbidden");
  const noRead = await send(person(["StopTurn"]), stop);
  assert.equal(!noRead.ok && noRead.error.code, "forbidden");

  const allowed = await send(person(["SendMessage"]), message);
  assert.equal(allowed.ok, true);
  assert.deepEqual([...new Set(callers)], ["user:me"]);
});

// session 조작도 같다. 쓰는 command의 scope와 먼저 읽는 route의 scope가 모두 있어야 한다.
test("session controls through AcpSend are forbidden without the scope of the routes they use", async () => {
  const { send } = setup();
  const base = { session: SES, key: "k" };
  const cases: { input: AcpInput; scope: string[] }[] = [
    {
      input: {
        ...base,
        type: "set_model",
        model: `${PVD}/gpt`,
        options: {},
      },
      scope: ["ReadSession", "ChangeSessionModel"],
    },
    {
      input: { ...base, type: "set_mode", mode: "skip" },
      scope: ["ReadSession", "ChangeSessionSkip"],
    },
    {
      input: { ...base, type: "rename", title: "name" },
      scope: ["ReadSession", "RenameSession"],
    },
    {
      input: { ...base, type: "compact" },
      scope: ["ReadSession", "RequestSessionCompact"],
    },
    {
      input: { ...base, type: "fork", message: null },
      scope: [receivedMessageList.name, "ForkSession"],
    },
    {
      input: {
        ...base,
        type: "rewind",
        message: MSG,
        files: false,
        apps: [],
      },
      scope: [sessionRewindPreview.name, "Rewind"],
    },
    {
      input: { ...base, type: "run_command", name: "review", argument: "" },
      scope: ["SendMessage"],
    },
  ] as { input: AcpInput; scope: string[] }[];

  for (const { input, scope } of cases) {
    const none = await send(person([]), input);
    assert.equal(!none.ok && none.error.code, "forbidden", input.type);
    for (const missing of scope) {
      const partial = await send(
        person(scope.filter((one) => one !== missing)),
        input,
      );
      assert.equal(!partial.ok && partial.error.code, "forbidden", input.type);
    }
    const allowed = await send(person(scope), input);
    assert.equal(allowed.ok, true, input.type);
  }
});

// 명령은 돌린 뒤에는 되돌릴 수 없다. 저장 권한이 없는 호출자의 명령은 돌리기 전에 거절한다.
test("run_shell does not run the command for a caller who cannot record it, and runs once per key", async () => {
  const { send, ran } = setup();
  const input: AcpInput = {
    type: "run_shell",
    session: SES,
    key: "k",
    command: "echo hi",
  } as AcpInput;
  const refused = await send(person(["ReadSession"]), input);
  assert.equal(!refused.ok && refused.error.code, "forbidden");
  assert.deepEqual(ran, []);

  const scope = person(["ReadSession", "RecordShellMessage"]);
  assert.equal((await send(scope, input)).ok, true);
  assert.equal((await send(scope, input)).ok, true);
  assert.deepEqual(ran, ["echo hi"]);
});

// 앱 이름표는 "그 앱 화면에서 보냈다"는 표시다. 기기가 아무 앱 이름이나 달면 사람이 다른 앱이 보낸 것으로 믿는다.
test("AcpSend keeps the app label only when the caller may use that app's screen", async () => {
  const APP = "app_01h455vb4pex5v6nkc6gd5f001";
  const labelled = {
    type: "send",
    session: SES,
    id: MSG,
    key: "k1",
    content: [{ type: "text", text: "hi" }],
    delivery: "next_turn",
    via_app: APP,
  } as AcpInput;
  const refused = setup(() => false);
  assert.ok((await refused.send(person(["SendMessage"]), labelled)).ok);
  assert.equal(
    Object.hasOwn(refused.envelopes[0]!.input as object, "via_app"),
    false,
  );
  const allowed = setup(() => true);
  assert.ok((await allowed.send(person(["SendMessage"]), labelled)).ok);
  assert.equal(
    (allowed.envelopes[0]!.input as { via_app?: string }).via_app,
    APP,
  );
});

const device = (id: string): AuthenticatedContext => ({
  principal: `device:${id}`,
  actor: "user",
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: `device:${id}`,
});

// coding session은 ledger route를 타지 않는다. 기기 자격이면 권한 mode 바꾸기는 늘 막고, shell 실행은 터미널 허락을 본다.
test("coding session input blocks set_mode for devices and gates shell execution on terminalInputGrant", async () => {
  const MSG2 = "msg_01h455vb4pex5v6nkc6gd5f002";
  const local = person([]);
  const phone = device("phone");
  const grantedPhone = device("granted");
  const granted = (principal: string) => principal === grantedPhone.principal;

  const setMode: AcpInput = {
    type: "set_mode",
    session: SES,
    key: "k1",
    mode: "skip",
  };
  const runShell: AcpInput = {
    type: "run_shell",
    session: SES,
    key: "k2",
    command: "whoami",
  };
  const bangSend: AcpInput = {
    type: "send",
    session: SES,
    id: MSG,
    key: "k3",
    content: [{ type: "text", text: "  !whoami" }],
    delivery: "next_turn",
  };
  const bangAfterAttachment: AcpInput = {
    type: "send",
    session: SES,
    id: MSG2,
    key: "k4",
    content: [
      {
        type: "resource_link",
        uri: "file:///tmp/photo.png",
        name: "photo.png",
        mimeType: "image/png",
      },
      { type: "text", text: "!id" },
    ],
    delivery: "next_turn",
  };
  const bangEditQueued: AcpInput = {
    type: "edit_queued",
    session: SES,
    message: MSG,
    content: [{ type: "text", text: "!rm -rf /" }],
  };
  const normalSend: AcpInput = {
    type: "send",
    session: SES,
    id: MSG,
    key: "k5",
    content: [{ type: "text", text: "hello!" }],
    delivery: "next_turn",
  };

  // 로컬 사용자는 그대로 통과한다.
  assert.equal(checkCodingInputScope(local, setMode, granted).ok, true);
  assert.equal(checkCodingInputScope(local, runShell, granted).ok, true);
  assert.equal(checkCodingInputScope(local, bangSend, granted).ok, true);

  // 터미널 입력 허락이 없는 기기: set_mode, run_shell, ! 글 모두 forbidden. 일반 메시지는 허용.
  for (const blocked of [
    setMode,
    runShell,
    bangSend,
    bangAfterAttachment,
    bangEditQueued,
  ]) {
    const res = checkCodingInputScope(phone, blocked, granted);
    assert.equal(!res.ok && res.error.code, "forbidden", blocked.type);
  }
  assert.equal(checkCodingInputScope(phone, normalSend, granted).ok, true);

  // 터미널 입력 허락이 있는 기기: shell은 허용하지만 set_mode는 여전히 forbidden.
  const grantedMode = checkCodingInputScope(grantedPhone, setMode, granted);
  assert.equal(!grantedMode.ok && grantedMode.error.code, "forbidden");
  assert.equal(checkCodingInputScope(grantedPhone, runShell, granted).ok, true);
  assert.equal(checkCodingInputScope(grantedPhone, bangSend, granted).ok, true);
  assert.equal(
    checkCodingInputScope(grantedPhone, bangAfterAttachment, granted).ok,
    true,
  );
  assert.equal(
    checkCodingInputScope(grantedPhone, bangEditQueued, granted).ok,
    true,
  );

  // acpWiring의 acp/send handler도 coding.send에 닿기 전에 같은 규칙으로 거른다.
  const dir = mkdtempSync(join(tmpdir(), "lophn-acp-coding-scope-"));
  const ledgerPath = join(dir, "ledger.sqlite");
  const init = openConnection(ledgerPath);
  assert.ok(init.ok);
  init.value.close();
  const forwarded: AcpInput[] = [];
  const wiring = acpWiring();
  try {
    const built = await wiring.build!({
      ledgerPath,
      clock: manualClock(1_700_000_000_000),
      random: seededRandom(1),
      root: { path: dir },
      peek: {
        knownSecrets: { ready: true, match: () => undefined },
        terminalInputGrant: granted,
      },
      bus: {
        publish() {},
        subscribe: () => () => {},
      },
      terminalAgents: {
        coding: {
          has: (session: string) => session === SES,
          send: (input: AcpInput) => {
            forwarded.push(input);
            return ok({});
          },
        },
      },
      runtime: { reads: new Map(), memory: { handlers: new Map() } },
      writer: { command: () => Promise.resolve(ok({})) },
      appViews: { hasLiveView: () => false },
      telemetry: {
        logger: {
          error(entry: unknown) {
            throw new Error(
              `unexpected logger.error: ${JSON.stringify(entry)}`,
            );
          },
        },
      },
    } as unknown as WiringContext);
    assert.ok(built.ok);
    const handler = new Map(built.value.memory).get(key(acpSend))!;
    const blockedMode = await handler(grantedPhone, setMode);
    assert.equal(!blockedMode.ok && blockedMode.error.code, "forbidden");
    const blockedShell = await handler(phone, runShell);
    assert.equal(!blockedShell.ok && blockedShell.error.code, "forbidden");
    const allowedShell = await handler(grantedPhone, runShell);
    assert.equal(allowedShell.ok, true);
    const allowedChat = await handler(phone, normalSend);
    assert.equal(allowedChat.ok, true);
    assert.deepEqual(
      forwarded.map((item) => item.type),
      ["run_shell", "send"],
    );
  } finally {
    wiring.closeIntake?.();
    wiring.closeWork?.();
    rmSync(dir, { recursive: true, force: true });
  }
});

// 줄 선 메시지를 고치거나 옮기면 acp wiring이 지우고 다시 세우는 AcpUpdated를 내서 다른 기기도 바로 맞춘다.
test("acpWiring relays queued edit and move as remove+queued AcpUpdated events", async () => {
  const MSG1 = "msg_01h455vb4pex5v6nkc6gd5f001";
  const MSG2 = "msg_01h455vb4pex5v6nkc6gd5f002";
  const dir = mkdtempSync(join(tmpdir(), "lophn-acp-queued-relay-"));
  const ledgerPath = join(dir, "ledger.sqlite");
  const init = openConnection(ledgerPath);
  assert.ok(init.ok);
  init.value.sql.run(
    `
    create table acp_items (
      session text not null,
      id text not null,
      seq integer not null,
      kind text not null,
      turn text,
      at text not null,
      data text,
      primary key (session, id)
    ) strict;
  `,
    [],
  );
  init.value.close();

  const messages = [
    {
      id: MSG1,
      session: SES,
      created_seq: "1",
      created_at: "2026-01-01T00:00:01.000Z",
      from: { kind: "human" as const },
      delivery: "next_turn" as const,
      shell: false,
      turn: null,
      call: null,
      reply_to: null,
      via: null,
    },
    {
      id: MSG2,
      session: SES,
      created_seq: "2",
      created_at: "2026-01-01T00:00:02.000Z",
      from: { kind: "human" as const },
      delivery: "next_turn" as const,
      shell: false,
      turn: null,
      call: null,
      reply_to: null,
      via: null,
    },
  ];
  const bodies = new Map<string, string>([
    [MSG1, "first"],
    [MSG2, "second"],
  ]);

  const published: AcpUpdate[] = [];
  const reads = new Map<
    string,
    (who: AuthenticatedContext, input: unknown) => Promise<Result<unknown>>
  >([
    [
      key(receivedMessageList),
      async () => ok({ messages: [...messages], next_cursor: null }),
    ],
    [
      key(turnList),
      async () =>
        ok({
          turns: [
            {
              id: TURN,
              session: SES,
              state: "running",
              started_at: "2026-01-01T00:00:00.000Z",
              finished_at: null,
              input_message: "msg_01h455vb4pex5v6nkc6gd5f000",
            },
          ],
          next_cursor: null,
        }),
    ],
    [key(toolCallList), async () => ok({ tool_calls: [], next_cursor: null })],
    [key(rewindList), async () => ok({ reverts: [], next_cursor: null })],
    [
      key(messageBody),
      async (_who, input) => {
        const id = (input as { message: string }).message;
        return ok({
          content: contentOfBlocks([{ type: "text", text: bodies.get(id)! }]),
        });
      },
    ],
  ]);

  const wiring = acpWiring();
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  try {
    const built = await wiring.build!({
      ledgerPath,
      clock: manualClock(1_700_000_000_000),
      random: seededRandom(2),
      root: { path: dir },
      peek: { knownSecrets: { ready: true, match: () => undefined } },
      bus: {
        publish(event: BusEvent) {
          if (event.type === "AcpUpdated") {
            published.push(event.payload.update);
          }
        },
        subscribe: () => () => {},
      },
      queue: {
        pendingSteering: () => [],
        isRunning: () => true,
      },
      liveTurns: {
        writing: () => null,
        elapsed: () => null,
      },
      approvals: { turnRequests: () => [] },
      questionWaits: { list: () => [] },
      terminalAgents: { coding: { has: () => false } },
      runtime: { reads, memory: { handlers: new Map() } },
      writer: { command: () => Promise.resolve(ok({})) },
      appViews: { hasLiveView: () => false },
      telemetry: {
        logger: {
          error(entry: unknown) {
            throw new Error(
              `unexpected logger.error: ${JSON.stringify(entry)}`,
            );
          },
        },
      },
    } as unknown as WiringContext);
    assert.ok(built.ok);

    let failNext = false;
    const inner = {
      async command(_who: AuthenticatedContext, envelope: CommandEnvelope) {
        if (failNext) {
          return err({
            code: "conflict",
            message: "the turn already took this message",
          });
        }
        if (envelope.command === editQueuedMessage.name) {
          const input = envelope.input as {
            message: string;
            content: { type: "text"; text: string }[];
          };
          bodies.set(input.message, input.content[0]!.text);
        } else if (envelope.command === moveQueuedMessage.name) {
          messages.reverse();
        }
        return ok({ result: {} } as never);
      },
    } as unknown as Writer;
    const writer = built.value.writer!(inner);

    // 다른 기기의 초기 상태: [MSG1("first"), MSG2("second")].
    let otherDevice = reduceAcp(
      reduceAcp(EMPTY_ACP_STATE, {
        type: "message_queued",
        queued: {
          id: MSG1,
          at: messages[0]!.created_at,
          content: [{ type: "text", text: "first" }],
        },
      }),
      {
        type: "message_queued",
        queued: {
          id: MSG2,
          at: messages[1]!.created_at,
          content: [{ type: "text", text: "second" }],
        },
      },
    );

    // 1) editQueuedMessage -> 다른 기기 화면의 첫 메시지 글이 순서 그대로 바뀐다.
    const edited = await writer.command(person([]), {
      command: editQueuedMessage.name,
      input: {
        session: SES,
        message: MSG1,
        content: [{ type: "text", text: "first edited" }],
      },
      idempotency_key: "k-edit",
      compare: {},
      prepared: [],
    });
    assert.ok(edited.ok);
    await flush();
    assert.ok(published.length > 0);
    for (const update of published.splice(0)) {
      otherDevice = reduceAcp(otherDevice, update);
    }
    assert.deepEqual(
      otherDevice.queued.map((one) => ({ id: one.id, content: one.content })),
      [
        { id: MSG1, content: [{ type: "text", text: "first edited" }] },
        { id: MSG2, content: [{ type: "text", text: "second" }] },
      ],
    );

    // 2) moveQueuedMessage -> 다른 기기 화면의 순서가 [MSG2, MSG1]로 바뀐다.
    const moved = await writer.command(person([]), {
      command: moveQueuedMessage.name,
      input: { session: SES, message: MSG2, direction: "up" },
      idempotency_key: "k-move",
      compare: {},
      prepared: [],
    });
    assert.ok(moved.ok);
    await flush();
    assert.ok(published.length > 0);
    for (const update of published.splice(0)) {
      otherDevice = reduceAcp(otherDevice, update);
    }
    assert.deepEqual(
      otherDevice.queued.map((one) => one.id),
      [MSG2, MSG1],
    );

    // 3) 실패한 edit는 갱신을 내지 않는다.
    failNext = true;
    const failed = await writer.command(person([]), {
      command: editQueuedMessage.name,
      input: {
        session: SES,
        message: MSG1,
        content: [{ type: "text", text: "ignored" }],
      },
      idempotency_key: "k-fail",
      compare: {},
      prepared: [],
    });
    assert.equal(!failed.ok && failed.error.code, "conflict");
    await flush();
    assert.deepEqual(published, []);
  } finally {
    wiring.closeIntake?.();
    wiring.closeWork?.();
    rmSync(dir, { recursive: true, force: true });
  }
});
