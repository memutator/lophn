import assert from "node:assert/strict";
import { test } from "node:test";
import { APP_KEEP_ALIVE_CHANNEL } from "../ipc/app-keep-alive.ts";
import { createAppTool } from "./app-tool.ts";

// 앱 코드의 useKeepAlive와 @lophn/agent의 자동 신호가 서로 끄지 않아야 page가 기다리던 답이 살아 있다.
test("keep-alive stays on while any key is active", () => {
  const sent: boolean[] = [];
  const app = createAppTool(
    {
      invoke: async () => undefined,
      send: () => {},
      sendToHost: (channel, input) => {
        if (channel === APP_KEEP_ALIVE_CHANNEL) sent.push(input as boolean);
      },
      on: () => {},
    },
    "",
  );
  app.setKeepAlive(true, "agent");
  app.setKeepAlive(true, "app");
  app.setKeepAlive(false, "app");
  assert.equal(sent.at(-1), true);
  app.setKeepAlive(false, "agent");
  assert.equal(sent.at(-1), false);
});
