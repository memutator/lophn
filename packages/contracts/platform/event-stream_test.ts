import { assert, assertEquals } from "@std/assert";
import { nextFromSeq } from "../../base/mod.ts";
import { eventEnvelopeBaseSchema } from "./events.ts";
import {
  EVENT_CLOSE_CREDENTIAL_REVOKED,
  EVENT_CLOSE_SLOW_CONSUMER,
  EVENT_SUBSCRIBE_PATH,
  EVENT_SUBSCRIBE_SUBPROTOCOL,
  eventsFrameSchema,
  nextFromSeq as exportedNextFromSeq,
  parseClientEventFrame,
  parseEventFrame,
  subscribeFrameSchema,
  unavailableFrameSchema,
} from "./event-stream.ts";

const DOC = "doc_01h455vb4pex5v6nkc6gd5fdw1";
const AT = "2026-10-04T05:46:07.123Z";

const sample = {
  seq: "101",
  type: "NotificationCreated",
  subject: DOC,
  actor: "machine",
  run: null,
  payload: { source_seq: "100" },
  at: AT,
};

Deno.test(
  "platform/api#R5: 구독은 from_seq를 포함하고 list의 after_seq 초과와 같은 위치에서 만난다",
  () => {
    assertEquals(EVENT_SUBSCRIBE_PATH, "/v1/events/subscribe");
    assertEquals(EVENT_SUBSCRIBE_SUBPROTOCOL, "lophn.events.1");
    const frame = {
      type: "subscribe",
      from_seq: "101",
      types: ["NotificationCreated"],
      subjects: [],
      subscriber: "shell-display",
      limit: 256,
    };
    assert(subscribeFrameSchema.safeParse(frame).success);
    assert(!subscribeFrameSchema.safeParse({ ...frame, extra: 1 }).success);
    assert(
      !subscribeFrameSchema.safeParse({ ...frame, from_seq: "0101" }).success,
    );
    // 처리 위치 100 다음은 101을 포함한다. list는 100 초과를 묻는다.
    const from = nextFromSeq("100");
    assert(from.ok);
    if (from.ok) assertEquals(from.value, frame.from_seq);
    assert(exportedNextFromSeq === nextFromSeq);
  },
);

Deno.test(
  "platform/api#R7: ack는 이름 있는 구독자의 through_seq만 싣고 감소 판정은 값으로 남긴다",
  () => {
    const ack = {
      type: "ack",
      subscriber: "shell-display",
      through_seq: "140",
    };
    const parsed = parseClientEventFrame(JSON.stringify(ack));
    assert(parsed.ok);
    if (parsed.ok && parsed.value.type === "ack") {
      assertEquals(parsed.value.through_seq, "140");
    }
    assert(!parseClientEventFrame(JSON.stringify({ ...ack, extra: 1 })).ok);
    assert(
      !parseClientEventFrame(JSON.stringify({ ...ack, subscriber: "" })).ok,
    );
    assert(
      !parseClientEventFrame(JSON.stringify({ ...ack, through_seq: "0140" }))
        .ok,
    );
  },
);

Deno.test(
  "platform/ledger#R9: events frame의 seq는 십진 문자열로 전달한다",
  () => {
    const big = (2n ** 53n + 1n).toString();
    const frame = {
      type: "events",
      events: [{ ...sample, seq: big }],
      scanned_through_seq: big,
      head_seq: big,
    };
    const parsed = eventsFrameSchema.safeParse(frame);
    assert(parsed.success);
    if (parsed.success) assertEquals(parsed.data.events[0]?.seq, big);
    assert(eventEnvelopeBaseSchema.safeParse(sample).success);
    assert(
      eventsFrameSchema.safeParse({ ...frame, later: true }).success,
    );
  },
);

Deno.test(
  "platform/security#R8: frame은 한도 안 schema로만 받고 거절은 안전한 unavailable이다",
  () => {
    assertEquals(EVENT_CLOSE_SLOW_CONSUMER, 1013);
    assertEquals(EVENT_CLOSE_CREDENTIAL_REVOKED, 1008);
    const rejected = parseEventFrame("{");
    assert(!rejected.ok);
    if (!rejected.ok) assertEquals(rejected.error.code, "invalid_input");
    const unknown = parseEventFrame(
      JSON.stringify({ type: "token", raw: "x" }),
    );
    assert(!unknown.ok);
    const safe = unavailableFrameSchema.safeParse({
      type: "unavailable",
      message: "slow consumer",
    });
    assert(safe.success);
    assert(
      unavailableFrameSchema.safeParse({
        type: "unavailable",
        message: "revoked",
        token: "raw",
      }).success,
    );
  },
);
