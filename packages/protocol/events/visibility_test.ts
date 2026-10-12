import {
  assertEquals,
  assertFalse,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import { z } from "zod";
import { err, ok, type Result } from "../../base/mod.ts";
import { definePort, type PortKey } from "../base/ports.ts";
import type { EventEnvelopeFor } from "./events.ts";
import type {
  EventVisibilityDefinition,
  ReadSnapshot,
  RequestContext,
} from "../server/registration.ts";

const DOC = "doc_01h455vb4pex5v6nkc6gd5fdw1";
const VERSION = "ver_01h455vb4pex5v6nkc6gd5fdw1";
const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const AT = "2026-10-04T05:46:07.123Z";

// 소유 concern이 등록한 event 예시. visibility hook은 이 등록 type에 묶인다.
const documentSaved = {
  type: "DocumentSaved",
  // subject·payload의 출력 type이 등록 schema를 보존해야 type 수준에서 좁혀진다.
  subject: z.templateLiteral(["doc_", z.string()]),
  payload: z.object({
    version: z.templateLiteral(["ver_", z.string()]),
    revision: z.number().int(),
  }),
} as const;

const CONTEXT: RequestContext = {
  principal: `app:${APP}`,
  actor: `app:${APP}`,
  scope: { operations: ["events/list"], targets: { app: APP } },
  conditions: { app: APP },
  credential_ref: "opaque-ref",
};

function envelope(
  over: Partial<EventEnvelopeFor<typeof documentSaved>> = {},
): EventEnvelopeFor<typeof documentSaved> {
  return {
    seq: "12",
    type: "DocumentSaved",
    subject: DOC,
    actor: "user",
    run: null,
    payload: { version: VERSION, revision: 3 },
    at: AT,
    ...over,
  };
}

Deno.test(
  "platform/identity#R8 platform/ledger#R15: 노출 hook의 event는 등록 type·subject·payload를 좁힌 envelope다",
  () => {
    const policy: EventVisibilityDefinition<typeof documentSaved> = {
      event: documentSaved,
      handle: () => ok(true),
    };
    // type은 등록된 event 이름으로 고정되고 다른 literal은 들어오지 않는다.
    const event = envelope();
    const literal: "DocumentSaved" = event.type;
    assertEquals(literal, "DocumentSaved");
    assertEquals(event.payload, { version: VERSION, revision: 3 });
    assertEquals(event.subject, DOC);
    assertEquals(policy.event, documentSaved);
    // envelope의 나머지 값은 base EventEnvelope 그대로다.
    const rest: Pick<
      EventEnvelopeFor<typeof documentSaved>,
      "seq" | "actor" | "run" | "at"
    > = { seq: "12", actor: "user", run: null, at: AT };
    assertEquals({ ...rest, ...event }, event);

    function rejections(
      snapshot: ReadSnapshot,
      ctx: RequestContext,
      value: EventEnvelopeFor<typeof documentSaved>,
    ) {
      return policy.handle(snapshot, ctx, value);
    }
    const snapshot = fakeSnapshot();
    // @ts-expect-error 다른 event type literal은 이 policy에 들어오지 않는다.
    rejections(snapshot, CONTEXT, envelope({ type: "DocumentUpdated" }));
    // @ts-expect-error subject가 등록 subject schema 밖이면 들어오지 않는다.
    rejections(snapshot, CONTEXT, envelope({ subject: "secret:provider" }));
    // @ts-expect-error payload에 등록에 없는 member가 있으면 들어오지 않는다.
    rejections(snapshot, CONTEXT, envelope({ payload: { other: 1 } }));
    // @ts-expect-error payload member의 값이 등록 schema와 다르면 들어오지 않는다.
    rejections(snapshot, CONTEXT, envelope({ payload: { version: 1 } }));
    // @ts-expect-error payload member의 다른 타입(버전 문자열을 숫자로)도 들어오지 않는다.
    rejections(snapshot, CONTEXT, envelope({ payload: { version: "1" } }));
    // @ts-expect-error payload member가 빠진 event도 들어오지 않는다.
    rejections(snapshot, CONTEXT, envelope({ payload: { revision: 3 } }));
  },
);

Deno.test(
  "platform/identity#R8 platform/ledger#R15: 노출 hook은 동기 Result만 돌려준다",
  () => {
    const asyncPolicy: EventVisibilityDefinition<typeof documentSaved> = {
      event: documentSaved,
      // @ts-expect-error 노출 판단은 비동기가 아니다(Promise를 결과로 내지 않는다).
      handle: async () => await Promise.resolve(ok(true)),
    };
    void asyncPolicy;

    const wrongValue: EventVisibilityDefinition<typeof documentSaved> = {
      event: documentSaved,
      // @ts-expect-error 결과는 boolean 하나로 감싼 Result다.
      handle: () => ok("yes"),
    };
    void wrongValue;

    const rawBoolean: EventVisibilityDefinition<typeof documentSaved> = {
      event: documentSaved,
      // @ts-expect-error Result를 감싸지 않은 boolean은 결과가 아니다.
      handle: () => true,
    };
    void rawBoolean;

    // throw는 type으로 막지 않는다. 이 type은 등록 모양만 고정하고 runtime은
    // throw를 숨김으로 바꾸지 않고 안전한 batch 오류로 처리한다.
    const throwing: EventVisibilityDefinition<typeof documentSaved> = {
      event: documentSaved,
      handle: () => {
        throw new Error("visibility failure");
      },
    };
    assertThrows(
      () => throwing.handle(fakeSnapshot(), CONTEXT, envelope()),
      Error,
      "visibility failure",
    );

    // 결정 omission(숨김)과 비결정 오류를 owner가 구분해 돌려준다.
    const visible = syncPolicy(ok(true));
    const hidden = syncPolicy(ok(false));
    const denied = syncPolicy(
      err({ code: "forbidden", message: "not visible" }),
    );
    const missing = syncPolicy(err({ code: "not_found", message: "no such" }));
    const broken = syncPolicy(err({ code: "internal", message: "broken" }));
    const unavailable = syncPolicy(
      err({ code: "unavailable", message: "unavailable" }),
    );
    assertEquals(visible, { ok: true, value: true });
    assertEquals(hidden, { ok: true, value: false });
    assertFalse(denied.ok);
    assertFalse(missing.ok);
    assertFalse(broken.ok);
    assertFalse(unavailable.ok);
  },
);

Deno.test(
  "platform/identity#R8: 노출 hook은 읽기 전용 snapshot과 지금 인증된 ctx, 그 event 하나만 받는다",
  () => {
    const seen: unknown[] = [];
    // owner 정책 구현은 자기 concern이 정한 상태를 snapshot.port로만 읽는다.
    const lookup = definePort<{ visible(doc: string): boolean }>(
      "documents.VisibilityLookup",
    );
    const policy: EventVisibilityDefinition<typeof documentSaved> = {
      event: documentSaved,
      handle(snapshot, ctx, event) {
        seen.push(snapshot, ctx, event);
        const trusted: string = ctx.credential_ref;
        assertEquals(trusted, "opaque-ref");
        return ok(snapshot.port(lookup).visible(event.subject));
      },
    };

    // 코어가 주입한 port 구현이 있는 sample owner.
    const owner: { visible(doc: string): boolean } = {
      visible: (doc) => doc === DOC,
    };
    const snapshot: ReadSnapshot = {
      as_of_seq: "12",
      sql: { get: () => undefined, all: () => [] },
      port: <T>(key: PortKey<T>): T => {
        assertStrictEquals(key, lookup);
        return owner as T;
      },
    };
    const event = envelope();
    const result = policy.handle(snapshot, CONTEXT, event);

    assertEquals(result, ok(true));
    assertEquals(seen.length, 3);
    assertStrictEquals(seen[0], snapshot);
    assertStrictEquals(seen[1], CONTEXT);
    // 검사 중인 그 envelope 하나가 그대로 전달된다.
    assertStrictEquals(seen[2], event);
    assertEquals(snapshot.as_of_seq, "12");
    // snapshot sql은 읽기 전용이다: get·all만 있다.
    assertEquals(Object.keys(snapshot.sql).sort(), ["all", "get"]);
    assertFalse("run" in snapshot.sql);
    // Tx 표면(emit·advanceSubscriberCursor·useApproval·call)도 없다.
    for (const member of ["emit", "advanceSubscriberCursor", "call"]) {
      assertFalse(member in snapshot);
    }
  },
);

// read snapshot에는 SQL 실행과 event 쓰기 경로가 없다(registration_test의 실행 가능한 검사와 같은 자리).
function absentOnSnapshot(snapshot: ReadSnapshot) {
  // @ts-expect-error read snapshot에서 SQL을 실행하지 않는다.
  snapshot.sql.run("DELETE FROM documents", []);
  // @ts-expect-error 노출 판단은 Tx를 받지 않아 transaction write 경로가 없다.
  snapshot.emit;
  // @ts-expect-error read snapshot은 Tx도 아니다.
  snapshot.advanceSubscriberCursor("sub", "1");
}
void absentOnSnapshot;

function fakeSnapshot(): ReadSnapshot {
  return {
    as_of_seq: "12",
    sql: { get: () => undefined, all: () => [] },
    port: () => {
      throw new Error("unused port");
    },
  };
}

// owner가 결정이나 오류를 동기 Result로 돌려주는 경로.
function syncPolicy(result: Result<boolean>): Result<boolean> {
  const policy: EventVisibilityDefinition<typeof documentSaved> = {
    event: documentSaved,
    handle: () => result,
  };
  return policy.handle(fakeSnapshot(), CONTEXT, envelope());
}
