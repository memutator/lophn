// coding relay: shell main이 `/host-link`로 올린 GUI handle의 ACP 상태(`coding_sync`, `coding_closed`)를 relay에 넣고
// `coding_sessions/{list,switch_plan,switch}`를 낸다. 터미널 보고(`coding_report`)와 연결이 끊긴 뒤의 비우기는 session lifecycle
// wiring이 표와 함께 relay에 넘긴다. `acp/snapshot`·`acp/send`의 분기는 acp wiring이 `ctx.codingRelay`로 한다.
import process from "node:process";
import { ok } from "../../../../base/mod.ts";
import {
  codingSessionsList,
  codingSessionsSwitch,
  codingSessionsSwitchPlan,
} from "../../../../protocol/coding-agent/relay.ts";
import { createCodingRelay } from "../../../coding-relay/mod.ts";
import type { KnownSecretMatch } from "../../../storage/ledger/mod.ts";
import { redactDeep } from "./acp-build.ts";
import { createProductRedactor, type WiringFactory } from "./context.ts";

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

const SOURCE = {
  concern: "coding-relay",
  revision: "1",
  scope: "conversation",
};

// host가 올린 상태 안의 모든 글을 제품 redactor로 거른다(acp wiring의 `env.redact`와 같은 규칙). 알려진 secret을 아직 다 모르면
// null이다: 빈 글로 바꾸면 갱신의 `type` 같은 칸까지 비어 상태가 깨지므로 아예 내지 않는다.
export function relayRedactor(
  known: () => Pick<KnownSecretMatch, "ready" | "match"> | undefined,
) {
  const text = createProductRedactor({
    get ready() {
      return known()?.ready ?? false;
    },
    match: (value: string) => known()?.match(value),
  });
  return <T>(value: T): T | null => {
    if (!(known()?.ready ?? false)) return null;
    return redactDeep(
      { redact: (one) => text(SOURCE, "text/plain", one) ?? "" },
      value,
    );
  };
}

export const codingRelayWiring: WiringFactory = () => ({
  name: "coding-relay",
  // session lifecycle과 acp wiring이 build에서 쓰므로 그보다 먼저 낸다. 다른 칸은 부를 때 읽는다.
  prepare(ctx) {
    ctx.provide(
      "codingRelay",
      createCodingRelay({
        clock: ctx.clock,
        publish: (event) => ctx.bus.publish(event),
        call: (request) => ctx.hostQueue.callCoding(request),
        attached: () => ctx.hostLink.attached(),
        redact: relayRedactor(() => ctx.peek.knownSecrets),
        platform: process.platform,
      }),
    );
  },
  build(ctx) {
    const relay = ctx.codingRelay;
    ctx.hostLink.onFrame("coding_sync", (frame) => relay.sync(frame));
    ctx.hostLink.onFrame("coding_closed", (frame) =>
      relay.closed(frame.session),
    );
    ctx.hostLink.onOpen(() => relay.shellChanged());
    ctx.hostLink.onClose(() => relay.shellChanged());
    return ok({
      memory: [
        [
          key(codingSessionsSwitch),
          (_who, input) =>
            relay.switch(
              input as { session: string; to: "gui" | "tui"; key: string },
            ),
        ],
      ],
      reads: (reads) =>
        reads
          .set(key(codingSessionsList), (_who, input) =>
            ok({
              shell: relay.shell(),
              sessions: relay.list((input as { project?: string }).project),
            }),
          )
          .set(key(codingSessionsSwitchPlan), (_who, input) =>
            relay.switchPlan((input as { session: string }).session),
          ),
    });
  },
});
