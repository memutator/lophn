import { assert, assertEquals, assertThrows } from "@std/assert";
import { z } from "zod";
import { nextFromSeq } from "../../base/mod.ts";
import { commandRequestSchema } from "./envelope.ts";
import {
  advanceSubscriberCursor,
  advanceSubscriberCursorCompareSchema,
  defineEvent,
  eventEnvelopeBaseSchema,
  eventEnvelopeSchema,
  eventsList,
  reactionKeySchema,
} from "./events.ts";
import { routePath } from "./route.ts";

const DOC = "doc_01h455vb4pex5v6nkc6gd5fdw1";
const RUN = "run_01h455vb4pex5v6nkc6gd5fdw1";
const AT = "2026-10-04T05:46:07.123Z";

const documentSaved = defineEvent("DocumentSaved", {
  subject: z.string().regex(/^doc_/),
  payload: z.object({ version: z.string() }),
});

function envelope(over: Record<string, unknown> = {}) {
  return {
    seq: "12",
    type: "DocumentSaved",
    subject: DOC,
    actor: "user",
    run: RUN,
    payload: { version: "ver_01h455vb4pex5v6nkc6gd5fdw1" },
    at: AT,
    ...over,
  };
}

Deno.test(
  "platform/ledger#R3: envelope는 seq·type·subject·actor·run·payload·at을 싣는다",
  () => {
    assert(eventEnvelopeBaseSchema.safeParse(envelope()).success);
    assert(
      eventEnvelopeBaseSchema.safeParse(envelope({ subject: null, run: null }))
        .success,
    );
    assert(
      eventEnvelopeBaseSchema.safeParse(
        envelope({ subject: "secret:provider-key" }),
      ).success,
    );
    const narrowed = eventEnvelopeSchema(documentSaved);
    assert(narrowed.safeParse(envelope()).success);
    assert(
      !narrowed.safeParse(envelope({ payload: { other: 1 } })).success,
    );
    assert(!narrowed.safeParse(envelope({ type: "DocumentUpdated" })).success);
  },
);

Deno.test(
  "platform/ledger#R3: event type은 <Entity><과거형 동사> PascalCase다",
  () => {
    assertThrows(() => defineEvent("documentSaved", documentSaved));
    assertThrows(() => defineEvent("Document_Saved", documentSaved));
    assertThrows(() => defineEvent("1DocumentSaved", documentSaved));
    assertEquals(documentSaved.type, "DocumentSaved");
    const accepted: { type: string; payload: z.ZodType } = documentSaved;
    assertEquals(accepted.type, "DocumentSaved");
  },
);

Deno.test(
  "platform/ledger#R8: envelope의 subject는 ID·자연키·null이고 actor·시각 밖은 거절한다",
  () => {
    for (
      const subject of [
        "DOC_01h455vb4pex5v6nkc6gd5fdw1",
        "secret:",
        ":key",
        "nope",
      ]
    ) {
      assert(
        !eventEnvelopeBaseSchema.safeParse(envelope({ subject })).success,
        subject,
      );
    }
    assert(
      !eventEnvelopeBaseSchema.safeParse(envelope({ actor: "someone" }))
        .success,
    );
    assert(
      !eventEnvelopeBaseSchema.safeParse(envelope({ at: "2026-10-04" }))
        .success,
    );
    assert(
      !eventEnvelopeBaseSchema.safeParse(
        envelope({ run: "doc_01h455vb4pex5v6nkc6gd5fdw1" }),
      )
        .success,
    );
  },
);

Deno.test(
  "platform/ledger#R9: envelope seq는 십진 문자열이고 큰 순번도 그대로 받는다",
  () => {
    const big = (2n ** 53n + 1n).toString();
    const parsed = eventEnvelopeBaseSchema.safeParse(envelope({ seq: big }));
    assert(parsed.success);
    if (parsed.success) assertEquals(parsed.data.seq, big);
    assert(!eventEnvelopeBaseSchema.safeParse(envelope({ seq: 12 })).success);
    assert(!eventEnvelopeBaseSchema.safeParse(envelope({ seq: "01" })).success);
  },
);

Deno.test(
  "platform/api#R5: list는 after_seq 초과만 묻고 구독의 from_seq 포함과 같은 위치로 맞춘다",
  () => {
    assertEquals(routePath(eventsList), "/v1/events/list");
    assertEquals(eventsList.kind, "read");
    const input = { after_seq: "140", limit: 256 };
    assert(eventsList.input.safeParse(input).success);
    assert(!eventsList.input.safeParse({ ...input, extra: 1 }).success);
    assert(!eventsList.input.safeParse({ after_seq: "0140" }).success);
    assert(!eventsList.input.safeParse({ after_seq: "0", limit: 257 }).success);
    assert(!eventsList.input.safeParse({ after_seq: "0", limit: 0 }).success);
    const output = {
      events: [envelope()],
      scanned_through_seq: "140",
      head_seq: "140",
    };
    assert(eventsList.output.safeParse(output).success);
    assert(eventsList.output.safeParse({ ...output, later: true }).success);
    // 처리 위치 P 다음은 from_seq이고, 그 직전 값이 list의 after_seq다.
    const from = nextFromSeq("140");
    assert(from.ok);
    if (from.ok) assertEquals(from.value, "141");
  },
);

Deno.test(
  "platform/ledger#R15: advance-cursor는 자기 cursor의 이전 seq를 비교 기준으로 받는다",
  () => {
    assertEquals(
      routePath(advanceSubscriberCursor),
      "/v1/events/advance-cursor",
    );
    assertEquals(advanceSubscriberCursor.name, "AdvanceSubscriberCursor");
    assertEquals([...advanceSubscriberCursor.actors], ["machine"]);
    const body = {
      input: { subscriber: "notifications", scanned_through_seq: "140" },
      idempotency_key: "k1",
      compare: { processed_through_seq: "100" },
      prepared: [],
    };
    assert(
      commandRequestSchema(advanceSubscriberCursor).safeParse(body).success,
    );
    assert(
      !commandRequestSchema(advanceSubscriberCursor).safeParse({
        ...body,
        compare: {},
      }).success,
    );
    assert(
      !advanceSubscriberCursorCompareSchema.safeParse({
        processed_through_seq: "100",
        extra: 1,
      }).success,
    );
  },
);

Deno.test(
  "platform/ledger#R15: 반응 idempotency 기준은 subscriber·cause_seq·reaction이다",
  () => {
    const key = {
      subscriber: "notifications",
      cause_seq: "140",
      reaction: "create_notification",
    };
    assert(reactionKeySchema.safeParse(key).success);
    assert(!reactionKeySchema.safeParse({ ...key, extra: 1 }).success);
    assert(!reactionKeySchema.safeParse({ ...key, cause_seq: "0140" }).success);
    assert(!reactionKeySchema.safeParse({ ...key, subscriber: "" }).success);
  },
);
