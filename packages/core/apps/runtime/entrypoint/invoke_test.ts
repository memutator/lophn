import assert from "node:assert/strict";
import { test } from "node:test";
import { readAppToolPort } from "../../invocations/context.ts";
import { handleCall } from "./invoke.ts";
import { createRuntimeState } from "./state.ts";

const ULID = "01j00000000000000000000000";

// 지우면 화면이 control frame 한도에 다시 막히거나(operation), 바깥 명령이 8 MiB를 agent에게 쏟는다(command).
test("256 KiB를 넘는 결과는 operation만 받고 같은 크기의 command 결과는 실패한다", async () => {
  const state = createRuntimeState({
    identity: {
      app: `app_${ULID}`,
      release: `rel_${ULID}`,
      bundleHash: "hash",
      mode: "live",
      processNonce: "nonce",
    },
    declaration: {
      operations: [{ name: "list", effect: "read" }],
      commands: [{ name: "list", inputSchema: null, effect: "read" }],
    } as never,
    broker: {} as never,
    store: {} as never,
    dataSchema: 1,
    controlSocket: "socket",
  });
  state.accepting = true;
  const big = "x".repeat(600 * 1024);
  readAppToolPort()!.register({ name: "list", handle: () => big });

  const call = (kind: "operation" | "command") =>
    handleCall(
      state,
      new TextEncoder().encode(
        JSON.stringify({
          invocation: `inv_${ULID}`,
          kind,
          name: "list",
          context: {
            app: `app_${ULID}`,
            release: `rel_${ULID}`,
            mode: "live",
            effect: "read",
            caller: null,
          },
        }),
      ),
    );

  const operation = await call("operation");
  assert.ok((operation.body as { result?: string }).result === big);
  const command = (await call("command")).body as { status: string };
  assert.deepStrictEqual(command.status, "error");
});
