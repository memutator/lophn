import assert from "node:assert/strict";
import { test } from "node:test";
import type { AcpInput as ProtocolInput } from "../../protocol/acp/input.ts";
import type {
  AcpItem as ProtocolItem,
  AcpState as ProtocolState,
  AcpUpdate as ProtocolUpdate,
} from "../../protocol/acp/mod.ts";
import { idSchema } from "../../protocol/base/ids.ts";
import type { LophnAppAgent } from "../../protocol/shell/app-bridge-types.ts";
import type { AcpInput, AcpItem, AcpState, AcpUpdate } from "./acp-types.ts";
import { newMessageId } from "./ids.ts";
import { parseReply } from "./reply.ts";
import type { AgentBridge } from "./session.ts";

// acp-types.ts는 설치 사본이 zod 없이 읽는 정본의 사본이다. 정본이 바뀌어 어긋나면 여기서 type 오류가 난다.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const same = <_T extends true>() => {};
same<Same<AcpState, ProtocolState>>();
same<Same<AcpUpdate, ProtocolUpdate>>();
same<Same<AcpItem, ProtocolItem>>();
// 이 SDK가 보내는 입력은 정본 입력의 부분이다.
same<AcpInput extends ProtocolInput ? true : false>();
// bridge의 type 인자를 이 SDK의 type으로 채우면 SDK의 bridge 사본이 된다.
same<
  LophnAppAgent<AcpState, AcpUpdate, AcpInput> extends AgentBridge
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
