import assert from "node:assert/strict";
import { test } from "node:test";
import type { AcpInput as ProtocolInput } from "../../protocol/acp/input.ts";
import type {
  AcpChildState as ProtocolChildState,
  AcpChildUpdate as ProtocolChildUpdate,
  AcpEntry as ProtocolEntry,
  AcpItem as ProtocolItem,
  AcpState as ProtocolState,
  AcpUpdate as ProtocolUpdate,
} from "../../protocol/acp/mod.ts";
import { idSchema } from "../../protocol/base/ids.ts";
import type { AgentCard as ProtocolAgentCard } from "../../protocol/lophn-agent/agent-definitions.ts";
import type {
  AppCallRow as ProtocolCallRow,
  CallSettledPayload as ProtocolCallSettled,
} from "../../protocol/lophn-agent/app-calls.ts";
import type {
  LophnAppAgent,
  LophnAppAgents,
  LophnAppCalls,
} from "../../protocol/shell/app-bridge-types.ts";
import type { AppBridge } from "./bridge.ts";
import type {
  AgentCard,
  CallRow,
  CallSendInput,
  CallSent,
  CallSettled,
} from "./call-types.ts";
import type {
  AcpChildState,
  AcpChildUpdate,
  AcpEntry,
  AcpInput,
  AcpItem,
  AcpState,
  AcpUpdate,
} from "./acp-types.ts";
import { newMessageId } from "./ids.ts";
import { parseReply } from "./reply.ts";
import type { AgentBridge } from "./session.ts";

// acp-types.ts는 설치 사본이 zod 없이 읽는 정본의 사본이다. 정본이 바뀌어 어긋나면 여기서 type 오류가 난다.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const same = <_T extends true>() => {};
same<Same<AcpState, ProtocolState>>();
same<Same<AcpUpdate, ProtocolUpdate>>();
same<Same<AcpItem, ProtocolItem>>();
// 설치 사본의 reduce.ts가 import하는 type이다. 하나라도 빠지면 사본이 tsc를 못 지난다.
same<Same<AcpEntry, ProtocolEntry>>();
same<Same<AcpChildState, ProtocolChildState>>();
same<Same<AcpChildUpdate, ProtocolChildUpdate>>();
// 이 SDK가 보내는 입력은 정본 입력의 부분이다.
same<AcpInput extends ProtocolInput ? true : false>();
// bridge의 type 인자를 이 SDK의 type으로 채우면 SDK의 bridge 사본이 된다.
same<
  LophnAppAgent<AcpState, AcpUpdate, AcpInput> extends AgentBridge
    ? true
    : false
>();

// 앱이 agent에게 보내는 call의 사본도 정본과 같다.
same<Same<CallRow, ProtocolCallRow>>();
same<Same<CallSettled, ProtocolCallSettled>>();
// 명함은 SDK가 enum을 string으로 느슨하게 적은 사본이라 정본이 사본에 들어가는지만 본다.
same<ProtocolAgentCard extends AgentCard ? true : false>();
same<
  LophnAppCalls<CallSendInput, CallSent, CallRow> extends NonNullable<
    AppBridge["calls"]
  >
    ? true
    : false
>();
same<
  LophnAppAgents<AgentCard> extends NonNullable<AppBridge["agents"]>
    ? true
    : false
>();

const SHAPE = {
  type: "object",
  required: ["annotations"],
  properties: {
    annotations: {
      type: "array",
      items: {
        type: "object",
        required: ["line", "severity"],
        properties: {
          line: { type: "integer" },
          severity: { enum: ["info", "bug"] },
        },
      },
    },
  },
} as const;

test("an agent reply that does not fit the shape is an error, not a value", () => {
  const wrong = [
    "not json at all",
    '```json\n{"annotations":[{"line":"3","severity":"bug"}]}\n```',
    '{"annotations":[{"line":3,"severity":"style"}]}',
    '{"annotations":[{"line":3}]}',
    "{}",
  ];
  for (const text of wrong) {
    assert.equal(parseReply(text, SHAPE).ok, false, text);
  }
  const fenced =
    'Here you go\n```json\n{"annotations":[{"line":3,"severity":"bug"}]}\n```';
  assert.deepEqual(parseReply(fenced, SHAPE), {
    ok: true,
    value: { annotations: [{ line: 3, severity: "bug" }] },
  });
  assert.equal(parseReply('{"annotations":[]}', SHAPE).ok, true);
});

test("a generated message id is one the core accepts", () => {
  assert.equal(idSchema("msg").safeParse(newMessageId()).success, true);
  assert.equal(
    idSchema("msg").safeParse(newMessageId(() => 2 ** 48 - 1)).success,
    true,
  );
});
