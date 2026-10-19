import { err, ok, type Result } from "../../../packages/base/mod.ts";
import { modelDefaultChange } from "../../../packages/protocol/lophn-agent/mod.ts";
import {
  connectFakeProvider,
  openSession,
  say,
  waitTurnEnd,
} from "../../support/core/human.ts";
import { startFakeServer } from "../../support/fake-server/mod.ts";
import { idIn, lastToolResult } from "../../support/fake-server/probe.ts";
import { tool } from "../../support/app/activate.ts";
import type { SetupContext } from "../types.ts";
import { loadMaterial, MATERIALS_ROOT, textOf } from "./manifest.ts";

type CallSpec = {
  to: { role: string; place: { project: string } };
  reply: string;
  body: string;
};

// 시나리오의 첫 단계에서 fake lophn이 call 재료의 본문을 보낸다. `endRestore`가 fake를 닫았고 진짜 model이 이미
// `real`에 붙어 있어서 자기 fake server를 따로 띄운다. lophn에는 전역 기본 model로 잠깐 붙이고 끝나면 다시 null로 둔다.
// 받는 쪽이 `real`이 아니면 이 구간에서 fake 답을 받을 수 있다.
export async function deliverCall(
  ctx: SetupContext,
  ref: string,
  root = MATERIALS_ROOT,
): Promise<Result<{ call: string }>> {
  const material = await loadMaterial(root, ref);
  if (material.manifest.kind !== "call") {
    return err({
      code: "invalid_input",
      message: `material ${ref} is not a call`,
    });
  }
  const spec = JSON.parse(textOf(material, "call.json")) as CallSpec;
  if (ctx.world.projects[spec.to.place.project] === undefined) {
    return err({
      code: "invalid_input",
      message: `call ${ref}: project ${spec.to.place.project} not restored`,
    });
  }
  const { core } = ctx;
  const fake = await startFakeServer();
  try {
    await connectFakeProvider(core, fake);
    fake.script([
      {
        reply: tool("t_deliver", "call", {
          to: spec.to,
          reply: spec.reply,
          body: spec.body,
          refs: [],
        }),
      },
      { reply: { kind: "text", text: "sent" } },
    ]);
    const session = await openSession(core, { role: "lophn" });
    await say(core, session, "deliver");
    await waitTurnEnd(core, session);
    const results = fake.journal().map((entry) =>
      lastToolResult(entry, "t_deliver") ?? ""
    ).join(" ");
    const call = idIn(results, "cal");
    if (call === undefined) {
      return err({
        code: "unavailable",
        message: `call ${ref} was not sent: ${results || "no tool result"}`,
      });
    }
    return ok({ call });
  } finally {
    await core.call(modelDefaultChange, { default: null });
    await fake.close();
  }
}
