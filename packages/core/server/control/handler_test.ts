import assert from "node:assert/strict";
import { test } from "node:test";

import { ok } from "../../../base/mod.ts";
import type { ConfirmationHandleRegister } from "../../../protocol/base/mod.ts";
import {
  controlConfirmationSchema,
  controlConnectSchema,
  CORE_CONTROL_PROTOCOL_VERSION,
  type ControlConnect,
} from "../../../protocol/supervision/core-control.ts";
import { createShellCapabilities } from "./capability.ts";
import { type ControlDeps, handleControlLine } from "./handler.ts";

const USER_TOKEN = "u".repeat(43);
const AGENT_TOKEN = "a".repeat(43);
const UNKNOWN_CAPABILITY = "x".repeat(43);
const BUGGY_CAPABILITY = "y".repeat(43);
const CONFIRMATION = "c".repeat(43);
const EXPIRES_AT = "2026-11-08T00:00:00.000Z";
const CONTENT_HASH = "d".repeat(64);

type Reply =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string } };

function fakeCore(options: { connectIncludesCapability?: boolean } = {}) {
  const capabilities = createShellCapabilities({
    random: (bytes) => bytes.fill(7),
  });
  const registered: ConfirmationHandleRegister[] = [];
  const deps: ControlDeps = {
    identify: async () =>
      ok({
        product_version: "0.22.0",
        protocol_version: CORE_CONTROL_PROTOCOL_VERSION,
        core_epoch: "epoch",
        api_url: "http://127.0.0.1:7431",
        state: "ready",
      }),
    connect: async (client) => {
      const connected = {
        user_token: client === "shell" ? USER_TOKEN : `${USER_TOKEN.slice(1)}c`,
        api_url: "http://127.0.0.1:7431",
        core_epoch: "epoch",
      };
      // 잘못 만든 core가 capability를 실어 보내는 경우를 흉내 낸다.
      const withCapability = {
        ...connected,
        shell_capability: BUGGY_CAPABILITY,
      };
      return ok(options.connectIncludesCapability ? withCapability : connected);
    },
    capabilities,
    register: async (register) => {
      registered.push(register);
      return ok({ confirmation: CONFIRMATION, expires_at: EXPIRES_AT });
    },
    closeWindow: async () => ok(null),
    shutdown: () => {},
    diagnostic: async () => ok(null),
  };
  return { deps, registered };
}

async function send(deps: ControlDeps, request: unknown): Promise<Reply> {
  const reply = await handleControlLine(deps, JSON.stringify(request));
  return reply.response as Reply;
}

async function failureCode(
  deps: ControlDeps,
  request: unknown,
): Promise<string> {
  const reply = await send(deps, request);
  return reply.ok ? "ok" : reply.error.code;
}

async function connectCore(
  deps: ControlDeps,
  client: "cli" | "shell",
): Promise<ControlConnect> {
  const reply = await send(deps, { type: "connect", client });
  assert.ok(reply.ok);
  const parsed = controlConnectSchema.safeParse(reply.value);
  assert.ok(parsed.success);
  return parsed.data;
}

function registerRequest(shellCapability?: string) {
  return {
    type: "confirmation_handle_register",
    ...(shellCapability === undefined
      ? {}
      : { shell_capability: shellCapability }),
    window_id: "win_1",
    target_ref: "app_1",
    content_hash: CONTENT_HASH,
    allowed_decisions: ["apps.grant.revoke"],
    expires_at: EXPIRES_AT,
  };
}

// shell capability 하나만 사람 결정 handle을 등록한다. HTTP user token, agent credential,
// CLI connect의 token, 잘못 발급된 connect는 그 길을 열지 못한다.
test("control handle 등록은 shell capability 하나로만 된다", async () => {
  const cli = fakeCore();
  const shell = fakeCore();
  const buggy = fakeCore({ connectIncludesCapability: true });
  const issuedCli = await connectCore(cli.deps, "cli");
  const issuedShell = await connectCore(shell.deps, "shell");
  const buggyConnect = await connectCore(buggy.deps, "cli");

  // 잘못 만든 core가 실어 보낸 capability도 connect 응답에서 버린다.
  assert.equal(issuedCli.shell_capability, undefined);
  assert.equal(buggyConnect.shell_capability, undefined);
  assert.equal(issuedShell.shell_capability?.length, 43);

  assert.equal(await failureCode(cli.deps, registerRequest()), "invalid_input");
  assert.equal(
    await failureCode(cli.deps, registerRequest(issuedCli.user_token)),
    "forbidden",
  );
  assert.equal(
    await failureCode(cli.deps, registerRequest(AGENT_TOKEN)),
    "forbidden",
  );
  assert.equal(
    await failureCode(cli.deps, registerRequest(UNKNOWN_CAPABILITY)),
    "forbidden",
  );
  assert.equal(
    await failureCode(buggy.deps, registerRequest(BUGGY_CAPABILITY)),
    "forbidden",
  );
  assert.deepEqual(cli.registered, []);
  assert.deepEqual(buggy.registered, []);

  const reply = await send(
    shell.deps,
    registerRequest(issuedShell.shell_capability),
  );
  assert.ok(reply.ok);
  const confirmation = controlConfirmationSchema.safeParse(reply.value);
  assert.ok(confirmation.success);
  assert.equal(confirmation.data.confirmation, CONFIRMATION);
  // capability는 writer 쪽 등록으로 넘어가지 않는다.
  assert.deepEqual(shell.registered, [
    {
      type: "confirmation_handle_register",
      window_id: "win_1",
      target_ref: "app_1",
      content_hash: CONTENT_HASH,
      allowed_decisions: ["apps.grant.revoke"],
      expires_at: EXPIRES_AT,
    },
  ]);
});
