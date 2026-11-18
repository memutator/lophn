import assert from "node:assert/strict";
import { test } from "node:test";

import { err, ok, type Result } from "../../../../base/mod.ts";
import type { AcpInput } from "../../../../protocol/acp/mod.ts";
import { workspaceSessionRead } from "../../../../protocol/lophn-agent/agent-sessions.ts";
import { receivedMessageList } from "../../../../protocol/lophn-agent/received-messages.ts";
import { sessionRewindPreview } from "../../../../protocol/lophn-agent/session-rewinds.ts";
import { turnRead } from "../../../../protocol/lophn-agent/turn-reads.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import { createAcpSend } from "./acp-send.ts";

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
