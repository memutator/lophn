import { assert, assertEquals } from "@std/assert";
import { nextFromSeq } from "../../base/mod.ts";
import { eventEnvelopeBaseSchema } from "./events.ts";
import {
  clientEventFrameSchema,
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
  "platform/api#R5: 이름 있는 재연결은 명시 from이 없어도 시작 seq를 주입하지 않고 통과한다",
  () => {
    const named = {
      type: "subscribe",
      types: [],
      subjects: [],
      subscriber: "shell-display",
    };
    const parsed = subscribeFrameSchema.safeParse(named);
    assert(parsed.success);
    // schema는 재연결 시작 seq를 정하지 않는다. "저장 ack + 1"과 "저장 없으면 0"은
    // platform runtime이 현재 principal·이름의 저장 위치로 정한다.
    if (parsed.success) {
      assert(!("from_seq" in parsed.data));
      assertEquals(parsed.data.subscriber, "shell-display");
    }
    const viaUnion = clientEventFrameSchema.safeParse(named);
    assert(viaUnion.success);
    if (viaUnion.success) assert(!("from_seq" in viaUnion.data));
    const viaEventParser = parseEventFrame(JSON.stringify(named));
    assert(viaEventParser.ok);
    if (viaEventParser.ok) assert(!("from_seq" in viaEventParser.value));
    const viaParser = parseClientEventFrame(JSON.stringify(named));
    assert(viaParser.ok);
    if (viaParser.ok) {
      assert(!("from_seq" in viaParser.value));
      assertEquals(viaParser.value.subscriber, "shell-display");
    }
    // 모르는 field와 존재하지 않는 frame도 그대로 거절한다.
    assert(!subscribeFrameSchema.safeParse({ ...named, extra: 1 }).success);
    assert(!clientEventFrameSchema.safeParse({ ...named, extra: 1 }).success);
    assert(!parseClientEventFrame(JSON.stringify({ ...named, extra: 1 })).ok);
  },
);

Deno.test(
  "platform/ledger#R15: 이름 없는 구독은 명시 from이 없으면 거절한다",
  () => {
    const unnamed = { type: "subscribe", types: [], subjects: [] };
    assert(!subscribeFrameSchema.safeParse(unnamed).success);
    assert(!clientEventFrameSchema.safeParse(unnamed).success);
    const parsed = parseClientEventFrame(JSON.stringify(unnamed));
    assert(!parsed.ok);
    if (!parsed.ok) assertEquals(parsed.error.code, "invalid_input");
    // 빈 이름은 이름 있는 구독이 아니다.
    assert(
      !subscribeFrameSchema.safeParse({ ...unnamed, subscriber: "" }).success,
    );
    assert(
      !subscribeFrameSchema.safeParse({
        ...unnamed,
        subscriber: "",
        from_seq: "0",
      }).success,
    );
    assert(
      !subscribeFrameSchema.safeParse({ ...unnamed, from_seq: null }).success,
    );
    // from_seq가 명시된 경우 name이 없어도 통과한다. 명시 from은 포함 위치다.
    for (const from_seq of ["0", "140", (2n ** 53n + 1n).toString()]) {
      for (const subscriber of [undefined, "shell-display"]) {
        const frame = {
          ...unnamed,
          from_seq,
          ...(subscriber === undefined ? {} : { subscriber }),
        };
        assert(subscribeFrameSchema.safeParse(frame).success);
        assert(clientEventFrameSchema.safeParse(frame).success);
        const parsed = parseClientEventFrame(JSON.stringify(frame));
        assert(parsed.ok);
        if (parsed.ok && parsed.value.type === "subscribe") {
          assertEquals(parsed.value.from_seq, from_seq);
          assertEquals(parsed.value.subscriber, subscriber);
        }
      }
    }
    for (const from_seq of ["0101", "-1", "", 0, 1.5, null]) {
      for (const subscriber of [undefined, "shell-display"]) {
        const frame = {
          ...unnamed,
          from_seq,
          ...(subscriber === undefined ? {} : { subscriber }),
        };
        assert(!subscribeFrameSchema.safeParse(frame).success);
        assert(!clientEventFrameSchema.safeParse(frame).success);
        assert(!parseClientEventFrame(JSON.stringify(frame)).ok);
      }
    }
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
