import { assertEquals, assertStringIncludes } from "@std/assert";
import { readAppToolPort } from "../../invocations/context.ts";
import { handleControl } from "./control.ts";
import { createRuntimeState } from "./state.ts";

// 선언과 handler가 다른 앱의 probe 거절이 release.prepare의 reason까지 가는 첫 자리다.
Deno.test("handler 없는 tool을 선언한 앱의 probe는 409로 거절하고 빠진·더해진 tool 이름을 말한다", () => {
  const state = createRuntimeState({
    identity: {
      app: "app",
      release: null,
      bundleHash: "hash",
      mode: "preview",
      processNonce: "nonce",
    },
    declaration: { tools: [{ name: "add_item" }] } as never,
    broker: {} as never,
    store: {} as never,
    dataSchema: 1,
    controlSocket: "socket",
  });
  // handler 등록은 모듈 전역이라 이 file 안에서만 쓴다.
  readAppToolPort()!.register({ tool: "stray_tool", handle: () => null });

  const rejected = handleControl(state, "/probe", { process_nonce: "nonce" });
  assertEquals(rejected.status, 409);
  const message = (rejected as { error: { message: string } }).error.message;
  assertStringIncludes(message, "add_item");
  assertStringIncludes(message, "stray_tool");
  assertEquals(state.ready, false);
});
