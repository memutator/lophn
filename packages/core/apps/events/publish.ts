// 앱 event의 전달과 앱의 발행. 전달(`createEventDelivery`)은 발행자가 앱이든 core(`lophn`)든 같다: 구독을 선언한 active 앱을 모으고,
// 지금 켜져 있는 앱마다 구독 handler를 앱 호출 경로(`app.call_tool`과 같은 길)로 부른다. 구독자의 답을 기다리지 않는다. 저장도
// 재시도도 없다: 켜져 있지 않은 구독자는 받지 못하고 그 수가 발행 기록에 남는다.
// 발행(`createEventPublisher`)은 발행 앱의 active release가 선언한 event이고 payload가 선언한 schema와 맞는지 보고 전달에 넘긴다.
import {
  err,
  type IdSource,
  ok,
  type RandomSource,
  type Result,
} from "../../../base/mod.ts";
import { newTraceId } from "../../../base/telemetry/mod.ts";
import type {
  ToolCallInput,
  ToolCallOutput,
} from "../../../protocol/apps/calls/mod.ts";
import {
  type AppEventPublishInput,
  EVENT_PAYLOAD_MAX_BYTES,
  type EventPublication,
} from "../../../protocol/apps/events.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import type { Sql, Tx } from "../../../protocol/server/mod.ts";
import type { MemoryHandler } from "../../server/mod.ts";
import type { CallAuth } from "../calls/caller.ts";
import type { Flight } from "../calls/intake.ts";
import { checkCallChain } from "../calls/loop.ts";
import {
  type AppDeclaration,
  subscriptionHandlerName,
  validateInput,
} from "../declaration/mod.ts";
import { insertPublication } from "./store.ts";

export type EventDeliveryDeps = {
  clock: { now(): string };
  ids: IdSource;
  random: RandomSource;
  // 지금 요청의 trace id. telemetry가 없거나 요청 밖이면 undefined라 새로 만든다.
  activeTraceId(): string | undefined;
  sql: Pick<Sql, "get" | "all">;
  transaction<T>(fn: (tx: Tx) => Result<T>): Result<T>;
  // 그 구독자가 process 호출을 받는 쪽인가. `running`은 process가 그 release로 떠 있고 받는 중이며 그 구독 handler를 등록했다. `down`은 handler를
  // 등록했을 수 있는데(process가 떠 있지 않아 모른다) 받을 수 없다. `none`은 process가 떠 있고 handler를 등록하지 않았다: 화면만 구독하는 앱이라
  // process에는 가지 않는다(호출 기록도 changeset도 남지 않는다). `none`은 reachable도 unreachable도 아니다.
  running(
    app: Id<"app">,
    release: Id<"rel">,
    handler: string,
  ): Promise<"running" | "down" | "none">;
  deliver(
    input: ToolCallInput,
    auth: CallAuth,
  ): Promise<Result<ToolCallOutput>>;
  failed(app: Id<"app">, event: string, message: string): void;
  // 열린 앱 화면이 받게 Bus로 알린다(`AppEventPublished`). 앱 process 구독자는 deliver가 부른다.
  // audience가 있으면 그 앱의 화면만 받는다.
  announce(published: {
    publisher: Id<"app"> | "lophn";
    source: string;
    event: string;
    payload: unknown;
    audience: readonly Id<"app">[] | null;
    at: string;
  }): void;
};

export type EventToDeliver = {
  // 발행자. 앱이면 그 앱이고 core가 내는 event는 `lophn`이다.
  publisher: Id<"app"> | "lophn";
  // 발행한 앱의 active release. core가 내면 null.
  release: Id<"rel"> | null;
  // 구독 선언의 source와 맞출 이름. 앱은 slug, core는 `lophn`.
  source: string;
  event: string;
  payload: unknown;
  // 이 event를 부른 인과의 앱들(발행자 포함). 구독자가 이미 있거나 깊이 한도에 닿으면 넘기지 않는다.
  chain: readonly Id<"app">[];
  // 발행이 앱 handler 안에서 일어났을 때 그 도는 호출(앱 호출과 같은 사슬 검사의 부모).
  parent: Flight | null;
  // 있으면 이 앱만 받는다(core event의 가시성: 앱이 볼 수 있는 session의 event만).
  audience?: (app: Id<"app">) => boolean;
};

type Subscriber = { app: Id<"app">; release: Id<"rel"> };

function subscribersOf(
  sql: Pick<Sql, "all">,
  source: string,
  event: string,
): Subscriber[] {
  return sql
    .all(
      `SELECT r.app AS app, r.id AS release FROM releases r JOIN apps a ON a.id = r.app
        WHERE r.status = 'active' AND a.status = 'active'
          AND EXISTS (
            SELECT 1 FROM json_each(r.declaration, '$.subscriptions') s
             WHERE json_extract(s.value, '$.source') = ?
               AND json_extract(s.value, '$.event') = ?
          )
        ORDER BY r.app`,
      [source, event],
    )
    .map((row) => ({
      app: String(row["app"]) as Id<"app">,
      release: String(row["release"]) as Id<"rel">,
    }));
}

// core 안 구독자(앱이 아니다). event를 받아 앱 호출 기록 없이 자기 일을 한다(예: event로 도는 job).
// 저장하지 않으므로 켜져 있는 동안 온 event만 본다.
export type InternalSubscriber = {
  // 이 source의 core event(`lophn`)를 보고 싶은가. 보고 싶지 않으면 core가 session 한 줄을 만들지도 않는다.
  wantsSource(source: string): boolean;
  // 모든 발행(앱과 core)에 불린다. 거르는 것은 받는 쪽이다. 기다리지 않는다.
  deliver(event: EventToDeliver): void;
};

export type EventDelivery = {
  // 안 구독자를 더한다. 푸는 함수를 돌려준다.
  addInternal(subscriber: InternalSubscriber): () => void;
  // 앱이 낸 event는 구독자가 없어도 발행 기록을 남긴다. core(`lophn`)가 낸 event는 볼 수 있는 구독자가 없으면 아무것도 하지 않는다(null):
  // 기록도 announce도 없다. session 상태가 바뀔 때마다 표에 한 줄씩 쓰지 않게 하려는 것이다.
  publish(event: EventToDeliver): Promise<Result<EventPublication | null>>;
  // 그 source의 event를 구독하겠다고 선언한 active 앱이 하나라도 있나(켜져 있는지는 보지 않는다).
  hasSubscribers(source: string): boolean;
};

export function createEventDelivery(deps: EventDeliveryDeps): EventDelivery {
  const internals = new Set<InternalSubscriber>();
  return {
    addInternal(subscriber) {
      internals.add(subscriber);
      return () => {
        internals.delete(subscriber);
      };
    },
    hasSubscribers(source) {
      if ([...internals].some((one) => one.wantsSource(source))) return true;
      return (
        deps.sql.get(
          `SELECT 1 AS found FROM releases r JOIN apps a ON a.id = r.app
            WHERE r.status = 'active' AND a.status = 'active'
              AND EXISTS (
                SELECT 1 FROM json_each(r.declaration, '$.subscriptions') s
                 WHERE json_extract(s.value, '$.source') = ?
              ) LIMIT 1`,
          [source],
        ) !== undefined
      );
    },
    async publish(event) {
      const handlerName = subscriptionHandlerName({
        source: event.source,
        event: event.event,
      });
      // core 안 구독자는 앱 구독자가 없어도 본다(보이는 범위와 사슬 거르기는 받는 쪽이 한다).
      for (const internal of internals) {
        try {
          internal.deliver(event);
        } catch {
          // 안 구독자의 오류가 앱 전달을 막지 않는다.
        }
      }
      const found = subscribersOf(deps.sql, event.source, event.event).filter(
        (subscriber) => event.audience?.(subscriber.app) ?? true,
      );
      if (event.publisher === "lophn" && found.length === 0) return ok(null);
      const running: Subscriber[] = [];
      let down = 0;
      await Promise.all(
        found.map(async (subscriber) => {
          const state = await deps.running(
            subscriber.app,
            subscriber.release,
            handlerName,
          );
          if (state === "running") running.push(subscriber);
          else if (state === "down") down += 1;
        }),
      );
      // 사슬에 이미 있는 앱이나 깊이 한도 밖은 넘기지 않는다. 센 수는 발행 기록에 남는다(말없이 버리지 않는다).
      const handed = running.filter(
        (subscriber) =>
          checkCallChain(subscriber.app, event.chain as Id<"app">[]) === null,
      );
      const publication: EventPublication = {
        id: deps.ids.newId("pub") as Id<"pub">,
        publisher: event.publisher,
        release: event.release,
        event: event.event,
        trace_id: deps.activeTraceId() ?? newTraceId(deps.random),
        at: deps.clock.now() as EventPublication["at"],
        reachable: running.length,
        unreachable: down,
        refused: running.length - handed.length,
      };
      const recorded = deps.transaction((tx) => {
        insertPublication(tx, publication);
        return ok(undefined);
      });
      if (!recorded.ok) return recorded;

      deps.announce({
        publisher: event.publisher,
        source: event.source,
        event: event.event,
        payload: event.payload,
        audience:
          event.audience === undefined
            ? null
            : deps.sql
                .all("SELECT id FROM apps WHERE status = 'active'", [])
                .map((row) => String(row["id"]) as Id<"app">)
                .filter(event.audience),
        at: publication.at,
      });

      const handler = subscriptionHandlerName({
        source: event.source,
        event: event.event,
      });
      for (const subscriber of handed) {
        // 기다리지 않는다. 끝나지 못한 호출은 그 호출의 invocation 기록이 말해 준다.
        deps
          .deliver(
            {
              target: { mode: "live", app: subscriber.app, release: null },
              kind: "operation",
              name: handler,
              input: event.payload as never,
              caller: {
                kind: "event",
                publisher: event.publisher,
                event: event.event,
                publication: publication.id,
                trace_id: publication.trace_id,
                chain: [...event.chain],
                parent_invocation: event.parent?.id ?? null,
              },
            },
            {
              actor: "event",
              event: {
                publisher: event.publisher,
                event: event.event,
                publication: publication.id as Id<"pub">,
                trace_id: publication.trace_id,
                chain: [...event.chain],
                parent: event.parent,
              },
            },
          )
          .then((delivered) => {
            if (!delivered.ok) {
              deps.failed(subscriber.app, event.event, delivered.error.message);
            }
          })
          .catch((thrown: unknown) =>
            deps.failed(
              subscriber.app,
              event.event,
              thrown instanceof Error ? thrown.name : "thrown",
            ),
          );
      }
      return ok(publication);
    },
  };
}

export type EventPublishDeps = {
  delivery: EventDelivery;
  // 그 앱의 slug와 보관 여부. 없는 앱은 null이다.
  app(id: string): Result<{ slug: string; archived: boolean } | null>;
  // active release와 그 고정 선언. 없으면 null이다.
  activeDeclaration(
    app: string,
  ): Result<{ release: Id<"rel">; declaration: AppDeclaration } | null>;
  flight(id: Id<"inv">): Flight | undefined;
  // 발행한 앱의 호출(`parent`, 이 앱의 것일 때만 본다. 다른 앱의 호출 id를 주면 빈 목록이다)까지 이어진 인과의 앱들(발행자 제외, 먼저 나온 순).
  // 그 호출이 event로 불린 것이면 그 event의 chain을 잇는다(호출 기록에서 읽는다: 앞선 발행자의 호출은 이미 끝났을 수 있다).
  ancestry(
    parent: Id<"inv"> | null,
    publisher: Id<"app">,
  ): readonly Id<"app">[];
};

export function createEventPublisher(deps: EventPublishDeps): MemoryHandler {
  return async (ctx, body) => {
    const actor = parseActor(ctx.actor);
    if (actor?.kind !== "app") {
      return err({ code: "forbidden", message: "only an app publishes" });
    }
    const input = body as AppEventPublishInput;
    const publisher = actor.id as Id<"app">;
    // 부른 앱의 도는 호출이다. 이 앱의 것이 아니거나 이미 끝났으면 사슬 없이 낸다. await 전에 잡아 둔다.
    const found =
      input.parent_invocation === null
        ? undefined
        : deps.flight(input.parent_invocation as Id<"inv">);
    const parent =
      found !== undefined && found.app === publisher ? found : null;

    const app = deps.app(publisher);
    if (!app.ok) return app;
    if (app.value === null) {
      return err({ code: "not_found", message: "app not found" });
    }
    if (app.value.archived) {
      return err({ code: "conflict", message: "app is archived" });
    }
    const active = deps.activeDeclaration(publisher);
    if (!active.ok) return active;
    if (active.value === null) {
      return err({ code: "conflict", message: "app has no active release" });
    }
    const declared = active.value.declaration.events?.find(
      (event) => event.name === input.event,
    );
    if (declared === undefined) {
      return err({
        code: "invalid_input",
        message: `event ${input.event} is not declared by the active release`,
      });
    }
    const checked = validateInput(declared.payloadSchema, input.payload);
    if (!checked.ok) {
      return err({ code: "invalid_input", message: checked.error.message });
    }
    if (
      new TextEncoder().encode(JSON.stringify(checked.value)).length >
      EVENT_PAYLOAD_MAX_BYTES
    ) {
      return err({
        code: "invalid_input",
        message: `event payload exceeds ${EVENT_PAYLOAD_MAX_BYTES} bytes`,
      });
    }
    const ancestors = deps.ancestry(
      parent === null
        ? (input.parent_invocation as Id<"inv"> | null)
        : parent.id,
      publisher,
    );
    const chain = [...new Set([...ancestors, publisher])];
    const published = await deps.delivery.publish({
      publisher,
      release: active.value.release,
      source: app.value.slug,
      event: input.event,
      payload: checked.value,
      chain,
      parent,
    });
    if (!published.ok) return published;
    if (published.value === null) {
      return err({ code: "internal", message: "app event was not recorded" });
    }
    const { id, reachable, unreachable, refused } = published.value;
    return ok({ publication: id, reachable, unreachable, refused });
  };
}
