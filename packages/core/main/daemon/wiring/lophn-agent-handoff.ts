import { ok } from "../../../../base/mod.ts";
import {
  createHandoffBodyPreparer,
  withHandoffBody,
} from "../../../lophn-agent/tools/handoff/body.ts";
import type { WiringFactory } from "./context.ts";

// handoff 내용(무엇·왜·제외·기대 결과)도 message body와 같은 길이다. 용어 후보·근거 변경은 writer에
// 닿기 전에 고정 판 본문의 출현을 확인한다.
export const lophnAgentHandoffWiring: WiringFactory = () => ({
  name: "lophn-agent-handoff",
  build: (ctx) =>
    ok({
      writer: (inner) =>
        withHandoffBody(
          inner,
          createHandoffBodyPreparer({
            relay: () => ctx.bodyPrepare,
            known: () => ctx.knownSecrets,
          }),
        ),
    }),
});
