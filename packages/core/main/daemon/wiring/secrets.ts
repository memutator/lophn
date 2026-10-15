import { ok } from "../../../../base/mod.ts";
import { secretInput } from "../../../../protocol/secrets/mod.ts";
import { SECRET_SCHEMA_STEPS } from "../../../secrets/mod.ts";
import {
  createSecretInputRelay,
  secretInputHandler,
} from "../../../secrets/input-relay.ts";
import { IO_ENDED, type WiringFactory } from "./context.ts";

export const secretsWiring: WiringFactory = () => ({
  name: "secrets",
  schemaStepsAfterTeams: SECRET_SCHEMA_STEPS,
  build(ctx) {
    // 보호 입력의 값은 I/O worker로만 간다. 준비 증거(값 없음)는 writer가 ledger에 남긴다.
    const relay = createSecretInputRelay({
      send: async (payload) => {
        const sent = await ctx.io.send("platform/io", payload);
        if (!sent.ok) throw new Error("보호 입력을 넘기지 못했다");
      },
      sendBytes: async (channel, chunk) => {
        const sent = await ctx.io.sendBytes("platform/io", channel, chunk);
        if (!sent.ok) throw new Error("보호 입력을 넘기지 못했다");
      },
      sendAbort: async (channel) => {
        await ctx.io.sendAbort("platform/io", channel);
      },
      record: (preparation) => ctx.runtime.recordSecretPreparation(preparation),
    });
    ctx.ioListeners.push({
      onMessage: (message) => relay.accept(message),
      onEnd: () => relay.failPending(IO_ENDED),
    });
    return ok({
      uploads: [[
        // 사람의 보호 입력 값: core는 해석·보관 없이 I/O worker의 keychain adapter로 흘린다.
        `${secretInput.resource}/${secretInput.method}`,
        secretInputHandler({ current: relay }),
      ]],
    });
  },
});
