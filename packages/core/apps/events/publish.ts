// 앱 event의 전달과 앱의 발행. 전달(`createEventDelivery`)은 발행자가 앱이든 core(`lophn`)든 같다: 구독을 선언한 active 앱을 모으고,
// 지금 켜져 있는 앱마다 구독 handler를 앱 호출 경로(`app.call_tool`과 같은 길)로 부른다. 구독자의 답을 기다리지 않는다. 저장도
// 재시도도 없다: 켜져 있지 않은 구독자는 받지 못하고 그 수가 발행 기록에 남는다.
// 발행(`createEventPublisher`)은 발행 앱의 active release가 선언한 event이고 payload가 선언한 schema와 맞는지 보고 전달에 넘긴다.
// 선언이 `across_machines`인 event는 이 기계에서 전달한 뒤 event file로도 쓴다(folder가 다른 기계로 나른다). 다른 기계에서 온
// event file은 `createEventArrival`이 같은 검사를 거쳐 이 기계에서 낸다. private 판단은 각 기계가 자기 call 정책으로 한다.
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
import type { JsonValue } from "../../../protocol/base/json-values.ts";
import { CROSS_EVENT_MAX_AGE_MS } from "../../../protocol/remote/carry.ts";
import { CLOCK_AHEAD_MAX_MS } from "../../../protocol/folder/limits.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import type { Sql, Tx } from "../../../protocol/server/mod.ts";
import type { CrossEvents, EventArrived } from "../../folder/ports.ts";
import type { MemoryHandler } from "../../server/mod.ts";
import type { CallAuth } from "../calls/caller.ts";
import type { Flight } from "../calls/intake.ts";
import { checkCallChain } from "../calls/loop.ts";
import {
  type AppDeclaration,
  type EventDeclaration,
  subscriptionHandlerName,
  validateInput,
} from "../declaration/mod.ts";
import { busEventSchema } from "../../../protocol/events/mod.ts";
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
    // 다른 컴퓨터가 이 event를 받아 구독자를 부를 때 쓰는 이 발행의 기록(`AppEventPublished`가 싣는다).
    publication: Id<"pub">;
    trace_id: string;
    chain: readonly Id<"app">[];
    cross_id?: string;
    machine?: Id<"mch">;
  }): void;
  // 구독 선언의 컴퓨터 이름이 가리키는 기계. 이름이 없거나 둘 이상이거나 이 컴퓨터이면 null이다(그 구독은 받지 못한다).
  machineOf(name: string): Id<"mch"> | null;
  // 다른 컴퓨터가 낸 event를 이 기계가 이미 냈는가를 적는다(`across_machines` event가 연결과 늦은 길로 둘 다 올 수 있다). 새로 적었으면 true.
  crossSeen(origin: Id<"mch">, app: Id<"app">, id: string): Result<boolean>;
  // 다른 기계가 낸 event의 발행 앱이 이 기계에도 있나: 있고, 보관하지 않았고, private이 아니고, active release가 그 event를 `across_machines`로
  // 선언하고, payload가 그 schema에 맞으면 이 기계에서의 slug. 같은 앱의 구독자(선언에 기계가 없는 것)는 그 event를 받는다.
  crossPublisher(
    app: Id<"app">,
    event: string,
    payload: unknown,
  ): string | null;
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
  // 다른 기계에서 온 event면 그 난 기계. 발행 기록과 구독자 호출의 caller에 싣는다.
  machine?: Id<"mch">;
  // `across_machines` event를 낸 기계가 event file에 붙인 id. 다른 컴퓨터가 연결로 받은 것과 file을 같은 event로 세는 key다.
  crossId?: string;
};

// 다른 컴퓨터가 연결로 보낸 이 event를 이 기계에서 내는 데 필요한 것(`AppEventPublished`의 payload와 발행 앱).
export type ReceivedAppEvent = {
  publisher: Id<"app">;
  source: string;
  event: string;
  payload: unknown;
  publication: Id<"pub">;
  trace_id: string;
  chain: readonly Id<"app">[];
  cross_id?: string;
};

// 다른 컴퓨터가 link로 보낸 글에서 이 기계가 낼 앱 event를 읽는다. 그 컴퓨터의 글이라 믿지 않고 bus event schema로 다시 읽고, 앱이 낸 것
// (subject가 앱이고 audience가 없고 되돌려 나른 것이 아니다)이 아니면 버린다.
export function receivedAppEvent(raw: unknown): ReceivedAppEvent | null {
  const parsed = busEventSchema.safeParse(raw);
  if (!parsed.success) return null;
  const event = parsed.data;
  if (
    event.type !== "AppEventPublished" ||
    event.subject === null ||
    event.payload.audience !== null ||
    event.payload.machine !== undefined
  ) {
    return null;
  }
  const { source, payload, publication, trace_id, chain, cross_id } =
    event.payload;
  return {
    publisher: event.subject as Id<"app">,
    source,
    event: event.payload.event,
    payload,
    publication: publication as Id<"pub">,
    trace_id,
    chain: chain as Id<"app">[],
    ...(cross_id === undefined ? {} : { cross_id }),
  };
}

type Subscriber = { app: Id<"app">; release: Id<"rel">; handler: string };

// (source, event)를 구독으로 선언한 active 앱. `accept`는 그 선언의 `machine`(이름. 없으면 null)을 보고 이 event를 받을 구독인지 정한다.
function subscribersOf(
  sql: Pick<Sql, "all">,
  source: string,
  event: string,
  accept: (machine: string | null) => boolean,
): Subscriber[] {
  const handler = subscriptionHandlerName({ source, event });
  return sql
    .all(
      `SELECT r.app AS app, r.id AS release, json_extract(s.value, '$.machine') AS machine
         FROM releases r JOIN apps a ON a.id = r.app, json_each(r.declaration, '$.subscriptions') s
        WHERE r.status = 'active' AND a.status = 'active'
          AND json_extract(s.value, '$.source') = ?
          AND json_extract(s.value, '$.event') = ?
        ORDER BY r.app`,
      [source, event],
    )
    .filter((row) =>
      accept(row["machine"] === null ? null : String(row["machine"])),
    )
    .map((row) => ({
      app: String(row["app"]) as Id<"app">,
      release: String(row["release"]) as Id<"rel">,
      handler,
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
  // 다른 컴퓨터가 연결로 보낸 앱 event를 이 기계에서 낸다. 그 기계에 발행 기록이 있으므로 이 기계에는 쓰지 않는다. 안 구독자(job)와
  // 그 컴퓨터의 앱을 구독으로 선언한 앱(선언의 `machine`이 그 컴퓨터), 같은 앱이 이 기계에도 있을 때 그 앱의 구독자가 받는다.
  // `cross_id`가 있고 이미 낸 event(늦은 길로 먼저 왔다)이면 아무것도 하지 않는다.
  receive(machine: Id<"mch">, event: ReceivedAppEvent): Promise<void>;
  // 그 source의 event를 구독하겠다고 선언한 active 앱이 하나라도 있나(켜져 있는지는 보지 않는다).
  hasSubscribers(source: string): boolean;
};

export function createEventDelivery(deps: EventDeliveryDeps): EventDelivery {
  const internals = new Set<InternalSubscriber>();

  function deliverInternal(event: EventToDeliver) {
    // core 안 구독자는 앱 구독자가 없어도 본다(보이는 범위와 사슬 거르기는 받는 쪽이 한다).
    for (const internal of internals) {
      try {
        internal.deliver(event);
      } catch {
        // 안 구독자의 오류가 앱 전달을 막지 않는다.
      }
    }
  }

  // 구독자 가운데 지금 받을 수 있는 것과 사슬에 막히지 않은 것. 센 수는 발행 기록에 남는다(말없이 버리지 않는다).
  async function reachable(
    found: readonly Subscriber[],
    chain: readonly Id<"app">[],
  ) {
    const running: Subscriber[] = [];
    let down = 0;
    await Promise.all(
      found.map(async (subscriber) => {
        const state = await deps.running(
          subscriber.app,
          subscriber.release,
          subscriber.handler,
        );
        if (state === "running") running.push(subscriber);
        else if (state === "down") down += 1;
      }),
    );
    const handed = running.filter(
      (subscriber) =>
        checkCallChain(subscriber.app, chain as Id<"app">[]) === null,
    );
    return { running, handed, down };
  }

  function handOff(
    subscriber: Subscriber,
    event: {
      publisher: Id<"app"> | "lophn";
      event: string;
      payload: unknown;
      chain: readonly Id<"app">[];
      parent: Flight | null;
      machine?: Id<"mch">;
    },
    publication: { id: Id<"pub">; trace_id: string },
  ) {
    // 기다리지 않는다. 끝나지 못한 호출은 그 호출의 invocation 기록이 말해 준다.
    deps
      .deliver(
        {
          target: { mode: "live", app: subscriber.app, release: null },
          kind: "operation",
          name: subscriber.handler,
          input: event.payload as never,
          caller: {
            kind: "event",
            publisher: event.publisher,
            event: event.event,
            publication: publication.id,
            trace_id: publication.trace_id,
            chain: [...event.chain],
            parent_invocation: event.parent?.id ?? null,
            ...(event.machine === undefined ? {} : { machine: event.machine }),
          },
        },
        {
          actor: "event",
          event: {
            publisher: event.publisher,
            event: event.event,
            publication: publication.id,
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
      deliverInternal(event);
      // 이 기계의 event는 기계를 적지 않은 구독만 받는다. 다른 기계에서 온 event(늦은 길)는 그 기계의 앱을 구독한 것과, 같은 앱이 이 기계에도
      // 있으므로(도착이 보았다) 기계를 적지 않은 구독이 받는다.
      const found = subscribersOf(
        deps.sql,
        event.source,
        event.event,
        (machine) =>
          machine === null ||
          (event.machine !== undefined &&
            deps.machineOf(machine) === event.machine),
      ).filter((subscriber) => event.audience?.(subscriber.app) ?? true);
      if (event.publisher === "lophn" && found.length === 0) return ok(null);
      const { running, handed, down } = await reachable(found, event.chain);
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
        machine: event.machine ?? null,
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
        publication: publication.id as Id<"pub">,
        trace_id: publication.trace_id,
        chain: event.chain,
        ...(event.crossId === undefined ? {} : { cross_id: event.crossId }),
        ...(event.machine === undefined ? {} : { machine: event.machine }),
      });

      for (const subscriber of handed) {
        handOff(subscriber, event, {
          id: publication.id as Id<"pub">,
          trace_id: publication.trace_id,
        });
      }
      return ok(publication);
    },
    async receive(machine, event) {
      // 다른 컴퓨터의 글이다: 크기를 다시 잰다.
      if (
        new TextEncoder().encode(JSON.stringify(event.payload ?? null)).length >
        EVENT_PAYLOAD_MAX_BYTES
      ) {
        return;
      }
      if (event.cross_id !== undefined) {
        const fresh = deps.crossSeen(machine, event.publisher, event.cross_id);
        if (!fresh.ok || !fresh.value) return;
      }
      deliverInternal({
        publisher: event.publisher,
        release: null,
        source: event.source,
        event: event.event,
        payload: event.payload,
        chain: [...event.chain],
        parent: null,
        machine,
      });
      const found = subscribersOf(
        deps.sql,
        event.source,
        event.event,
        (declared) => declared !== null && deps.machineOf(declared) === machine,
      );
      // 같은 앱이 이 기계에도 있으면 그 앱의 구독자(기계를 적지 않았다)도 받는다. 이 기계에서의 slug로 맞춘다.
      const slug = deps.crossPublisher(
        event.publisher,
        event.event,
        event.payload,
      );
      if (slug !== null) {
        for (const subscriber of subscribersOf(
          deps.sql,
          slug,
          event.event,
          (declared) => declared === null,
        )) {
          if (
            !found.some(
              (one) =>
                one.app === subscriber.app &&
                one.handler === subscriber.handler,
            )
          ) {
            found.push(subscriber);
          }
        }
      }
      const { handed } = await reachable(found, event.chain);
      for (const subscriber of handed) {
        handOff(
          subscriber,
          {
            publisher: event.publisher,
            event: event.event,
            payload: event.payload,
            chain: event.chain,
            parent: null,
            machine,
          },
          { id: event.publication, trace_id: event.trace_id },
        );
      }
    },
  };
}

// 발행과 도착이 같이 쓰는 면.
type AppEventDeps = {
  delivery: EventDelivery;
  // 그 앱의 slug와 보관 여부. 없는 앱은 null이다.
  app(id: string): Result<{ slug: string; archived: boolean } | null>;
  // active release와 그 봉인 bundle hash, 고정 선언. 없으면 null이다.
  activeDeclaration(app: string): Result<{
    release: Id<"rel">;
    bundle_hash: string;
    declaration: AppDeclaration;
  } | null>;
  // 이 기계의 call 정책에서 그 앱 workspace가 private인가. private인 앱의 event는 기계를 건너지 않는다.
  isPrivate(app: Id<"app">): boolean;
  warn(event: string, fields: Record<string, string>): void;
};

// payload가 선언한 schema와 크기 한도에 맞으면 정규화한 값.
function checkPayload(
  declared: EventDeclaration,
  payload: unknown,
): Result<unknown> {
  const checked = validateInput(declared.payloadSchema, payload);
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
  return ok(checked.value);
}

/**
 * 다른 기계가 낸 event의 발행 앱이 이 기계에도 있나(`EventDeliveryDeps.crossPublisher`). 있고, 보관하지 않았고, private이 아니고, active
 * release가 그 event를 `across_machines`로 선언하고, payload가 그 schema에 맞으면 이 기계에서의 slug다. 늦은 길의 도착이 보는 것과 같다
 * (release의 bundle과 나이는 file이 싣는 것이라 연결로 온 event에는 없다).
 */
export function crossPublisherOf(
  deps: Pick<AppEventDeps, "app" | "activeDeclaration" | "isPrivate">,
): EventDeliveryDeps["crossPublisher"] {
  return (app, event, payload) => {
    const found = deps.app(app);
    if (!found.ok || found.value === null || found.value.archived) return null;
    if (deps.isPrivate(app)) return null;
    const active = deps.activeDeclaration(app);
    if (!active.ok || active.value === null) return null;
    const declared = active.value.declaration.events?.find(
      (each) => each.name === event,
    );
    if (declared?.across_machines !== true) return null;
    return checkPayload(declared, payload).ok ? found.value.slug : null;
  };
}

export type EventPublishDeps = AppEventDeps & {
  ids: IdSource;
  // folder가 낸다. `across_machines` event를 다른 기계로 갈 event file로 쓴다.
  crossEvents: CrossEvents;
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
    const checked = checkPayload(declared, input.payload);
    if (!checked.ok) return checked;
    const ancestors = deps.ancestry(
      parent === null
        ? (input.parent_invocation as Id<"inv"> | null)
        : parent.id,
      publisher,
    );
    const chain = [...new Set([...ancestors, publisher])];
    // 다른 기계로 갈 event는 file id를 먼저 만든다: 연결로 가는 `AppEventPublished`와 event file이 같은 id를 실어, 받는 기계가 둘을 한 event로 센다.
    const crossId =
      declared.across_machines === true && !deps.isPrivate(publisher)
        ? deps.ids.newId("evt").slice(4)
        : undefined;
    const published = await deps.delivery.publish({
      publisher,
      release: active.value.release,
      source: app.value.slug,
      event: input.event,
      payload: checked.value,
      chain,
      parent,
      ...(crossId === undefined ? {} : { crossId }),
    });
    if (!published.ok) return published;
    if (published.value === null) {
      return err({ code: "internal", message: "app event was not recorded" });
    }
    const { id, reachable, unreachable, refused, at } = published.value;
    if (crossId !== undefined) {
      // 다른 기계로 못 가도 이 기계의 발행은 이미 끝났다.
      const written = await deps.crossEvents.write(
        publisher,
        active.value.release,
        {
          id: crossId,
          name: input.event,
          payload: checked.value as JsonValue,
          at,
        },
      );
      if (!written.ok) {
        deps.warn("cross_event_write_failed", {
          app: publisher,
          name: input.event,
          message: written.error.message,
        });
      }
    }
    return ok({ publication: id, reachable, unreachable, refused });
  };
}

export type EventArrivalDeps = AppEventDeps & { nowMs(): number };

/**
 * 다른 기계에서 온 event file 하나를 이 기계에서 낸다. 이 기계에 그 앱이 있고, 이 기계의 call 정책에서 그 앱 workspace가
 * private이 아니고, `at`이 나이 한도 안이고, 이 기계 활성 release가 같은 bundle이고 그 선언이 그 event를 `across_machines`로
 * 두며 payload가 schema에 맞을 때만이다. 아니면 log 한 줄을 남기고 내지 않는다. 한 번만 내는 것은 부르는 쪽(folder)이 지킨다.
 */
export function createEventArrival(deps: EventArrivalDeps): EventArrived {
  async function arrive(input: Parameters<EventArrived>[0]): Promise<void> {
    const skip = (reason: string) =>
      deps.warn("cross_event_skipped", {
        app: input.app,
        name: input.name,
        machine: input.origin,
        reason,
      });
    const app = deps.app(input.app);
    if (!app.ok || app.value === null || app.value.archived) {
      return skip("app");
    }
    if (deps.isPrivate(input.app)) return skip("private");
    const at = Date.parse(input.at);
    const now = deps.nowMs();
    if (
      !(now - at <= CROSS_EVENT_MAX_AGE_MS && at - now <= CLOCK_AHEAD_MAX_MS)
    ) {
      return skip("age");
    }
    const active = deps.activeDeclaration(input.app);
    if (!active.ok || active.value === null) return skip("release");
    if (active.value.bundle_hash !== input.bundle_hash) {
      return skip("release");
    }
    const declared = active.value.declaration.events?.find(
      (event) => event.name === input.name,
    );
    if (declared?.across_machines !== true) return skip("not_declared");
    const checked = checkPayload(declared, input.payload);
    if (!checked.ok) return skip("payload");
    const published = await deps.delivery.publish({
      publisher: input.app,
      release: active.value.release,
      source: app.value.slug,
      event: input.name,
      payload: checked.value,
      chain: [input.app],
      parent: null,
      machine: input.origin,
    });
    if (!published.ok) skip(`publish: ${published.error.message}`);
  }
  return (input) => {
    void arrive(input).catch((thrown: unknown) =>
      deps.warn("cross_event_skipped", {
        app: input.app,
        name: input.name,
        machine: input.origin,
        reason: thrown instanceof Error ? thrown.name : "thrown",
      }),
    );
  };
}
