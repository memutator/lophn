import { assertEquals } from "@std/assert";
import type { AppRevertBinding } from "../../../packages/protocol/lophn-agent/mod.ts";
import {
  NotSent,
  ResultLost,
} from "../../../packages/core/apps/runtime/client/mod.ts";
import { acceptRevertCall } from "./revert.ts";

// 앱 revert 호출 worker(lophn-agent/revert R10·R11). 요청이 싣는 사람 자격의 apps/connect 연결로
// request_key=step_key를 보내고, 닿지 못함·거절·응답 유실·성공을 구별한다. 전송은 가짜다.

const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";
function id(prefix: string, n: number): string {
  return `${prefix}_01arz3ndektsv4rrffq69g5f${ALPHA[n >> 5]}${ALPHA[n & 31]}`;
}

const APP = id("app", 1);
const REL = id("rel", 1);
const TOKEN = "u".repeat(43);

const binding: AppRevertBinding = {
  app: APP,
  release: REL,
  command: "add_todo",
  tool_call: id("tcl", 1),
  invocation: id("inv", 1),
  receipt: "change:1",
  expected_revision: "1",
  revert_command: "revert_todo",
  step_key: `${id("rvt", 1)}:${id("inv", 1)}`,
  revert_invocation: null,
};

const connection = (release: string | null) => ({
  endpoint: "/run/lophn/app.sock",
  signature: "s".repeat(86),
  connection: {
    app: APP,
    release,
    bundle_hash: "a".repeat(64),
    mode: "live",
    process_nonce: "nonce",
    actor: "user",
    credential_ref: "cred-user",
    screens: ["main"],
    screen_sizes: {},
    caller: null,
    commands: ["revert_todo"],
    expires_at: null,
  },
});

function harness() {
  const sent: unknown[] = [];
  const call = (
    release: string | null,
    direct: (body: unknown) => Promise<{ status: number; body: unknown }>,
  ) =>
    acceptRevertCall({
      type: "worker_request",
      request_id: "cred-user/test",
      op: "revert.call",
      payload: { credential: TOKEN, binding },
    }, {
      core: () => Promise.resolve({ status: 200, body: connection(release) }),
      direct: (_endpoint, request) => {
        sent.push(request.body);
        return direct(request.body);
      },
    });
  return { call, sent };
}

Deno.test("lophn-agent/revert#R10: the worker sends the revert command with request_key=step_key and returns the invocation the app made", async () => {
  const { call, sent } = harness();
  const revertInvocation = id("inv", 77);
  const done = await call(REL, () =>
    Promise.resolve({
      status: 200,
      body: {
        result: { result: {} },
        invocation: revertInvocation,
        mode: "live",
      },
    }));
  assertEquals(done, { result: "restored", invocation: revertInvocation });
  assertEquals(sent[0], {
    request_key: binding.step_key,
    release: REL,
    command: "revert_todo",
    input: {
      invocation: binding.invocation,
      receipt: "change:1",
      expected_revision: "1",
    },
  });
});

Deno.test("lophn-agent/revert#R11: a refusal or an unreachable app is a failure, a lost response is uncertain", async () => {
  const { call } = harness();
  assertEquals(
    await call(REL, () =>
      Promise.resolve({
        status: 409,
        body: { error: { code: "conflict", message: "changed" } },
      })),
    { result: "failure", invocation: null },
  );
  assertEquals(
    await call(REL, () => Promise.reject(new NotSent())),
    { result: "failure", invocation: null },
  );
  assertEquals(
    await call(REL, () => Promise.reject(new ResultLost())),
    { result: "uncertain", invocation: null },
  );
});

Deno.test("lophn-agent/revert#R10: a release other than the original write's is never sent to", async () => {
  const { call, sent } = harness();
  assertEquals(
    await call(id("rel", 2), () => Promise.reject(new Error("no"))),
    { result: "failure", invocation: null },
  );
  assertEquals(sent, []);
});

Deno.test("lophn-agent/revert#R11: an answer without the invocation the app made is not a restore", async () => {
  const { call } = harness();
  assertEquals(
    await call(REL, () =>
      Promise.resolve({
        status: 200,
        body: { result: { result: {} }, mode: "live" },
      })),
    { result: "uncertain", invocation: null },
  );
});
