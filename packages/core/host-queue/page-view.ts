// 멀리서 page 보기(`page_view/*`): 보는 principal의 lease, 탭마다 host가 민 최신 frame 하나와 상태(메모리), 입력 key 기억이다.
// lease가 있는 탭만 host가 frame을 밀고(`page_stream`), core는 최신 하나만 두고 내용 없는 `PageViewChanged`로 알린다. 보는 쪽이
// snapshot으로 frame을 읽어 가면 host에 `page_read`를 보내고, host는 그것이 올 때까지 다음 frame을 보내지 않는다.
// 대상은 core 표의 browser 탭이다. 보는 것은 사람 자격 모두, 다루는 것(input·control·open)은 터미널 입력을 허락받은 기기다.
import {
  type Clock,
  err,
  type LophnError,
  ok,
  type Result,
} from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import type { BusEvent } from "../../protocol/events/bus.ts";
import type { HostFrameOf } from "../../protocol/host-link/frames.ts";
import type {
  BrowserTabState,
  LinkRequest,
} from "../../protocol/lophn-agent/host-queue.ts";
import {
  PAGE_VIEW_LEASE_MS,
  type PageFrame,
  type PageInput,
} from "../../protocol/lophn-agent/page-view.ts";
import type { AuthenticatedContext } from "../../protocol/server/mod.ts";
import type { TabOwner } from "./queue.ts";

// 탭마다 기억하는 입력 key 수와 다시 보낸 open을 알아보는 key 수(전체).
const KEYS_MAX = 200;

export type PageViewDeps = {
  clock: Clock;
  publish(event: BusEvent): void;
  // host에 보내는 연결 요청이다(queue의 `callLink`). 연결이 없거나 닫히거나 기한이 지나면 `unavailable`이다.
  call(request: LinkRequest): Promise<Result<unknown>>;
  // core 표의 browser 탭 전부다(queue의 `pages`).
  pages(): readonly {
    tab: Id<"tab">;
    owner: TabOwner;
    state: BrowserTabState | null;
  }[];
  // session의 agent가 보이는 이름. 못 읽으면 null.
  agentName(session: string): string | null;
  // 이 principal이 page를 다룰 수 있다(터미널 입력 허락).
  mayControl(principal: string): boolean;
  // 사람이 이 기계에 browser 탭을 연다.
  open(who: Who, url: string): Promise<Result<{ tab: Id<"tab"> }>>;
  // page가 정한 url·title이 보는 쪽에 가기 전에 지나는 redaction. 알려진 값을 아직 다 모르면 null이다.
  redact(text: string): string | null;
};

type Who = AuthenticatedContext;

// 탭의 최신 frame과 상태. hostSeq는 그 frame의 host seq, read는 `page_read`로 마지막에 알린 host seq다.
type View = {
  seq: number;
  frame: PageFrame | null;
  hostSeq: number;
  read: number | null;
  painting: boolean;
  agent: boolean;
  held: boolean;
};

const NO_SUCH_TAB = "No such browser tab on the computer, or it was closed.";
const UNCHECKED = "the browser result could not be checked for secrets";

// 이 route들이 선언한 code 가운데 host가 돌려줄 수 있는 것만 그대로 내보낸다. 나머지는 unavailable이다.
const PASSED_CODES = new Set<string>([
  "invalid_input",
  "not_found",
  "conflict",
  "unavailable",
]);
const passed = (error: LophnError): LophnError =>
  PASSED_CODES.has(error.code) ? error : { ...error, code: "unavailable" };

const forbidden = (message: string) =>
  err({ code: "forbidden" as const, message });
// frame은 사람이 로그인한 page의 그림이다. route의 actors와 같은 선을 여기서도 지킨다.
const notUser = () => forbidden("only a person may view browser pages");
const mayNot = () => forbidden("This device may not control browser pages.");
const gone = () => err({ code: "not_found" as const, message: NO_SUCH_TAB });

// 같은 key는 한 번만 한다. 보내는 중이거나 성공한 것의 답을 주고, 실패한 key는 잊어 다시 보낼 수 있게 한다(`terminals/routes.ts`와 같다).
function once<T>(
  table: Map<string, Promise<Result<T>>>,
  key: string,
  run: () => Promise<Result<T>>,
): Promise<Result<T>> {
  const seen = table.get(key);
  if (seen !== undefined) return seen;
  const sending = run().then((done) => {
    if (!done.ok && table.get(key) === sending) table.delete(key);
    return done;
  });
  table.set(key, sending);
  while (table.size > KEYS_MAX) table.delete(table.keys().next().value!);
  return sending;
}

export function createPageView(deps: PageViewDeps) {
  // 키는 `<principal>\n<tab>`이다.
  const leases = new Map<string, { tab: Id<"tab">; expiresAt: number }>();
  const views = new Map<Id<"tab">, View>();
  // host에 켜 달라고 한 탭(성공한 것만). 연결이 닫히면 host가 잃으므로 비운다.
  const sent = new Set<Id<"tab">>();
  const flying = new Map<Id<"tab">, Promise<Result<unknown>>>();
  const keys = new Map<Id<"tab">, Map<string, Promise<Result<unknown>>>>();
  const opens = new Map<string, Promise<Result<{ tab: Id<"tab"> }>>>();
  // 탭을 연 session의 agent 이름. 이름을 읽으면 ledger 연결을 새로 열고 snapshot은 frame마다 오므로 session마다 한 번만 읽는다.
  // 모르는(null) 이름은 기억하지 않는다.
  const names = new Map<string, string>();
  const nameOf = (session: string) => {
    const known = names.get(session);
    if (known !== undefined) return known;
    const name = deps.agentName(session);
    if (name !== null) names.set(session, name);
    return name;
  };

  const page = (tab: Id<"tab">) =>
    deps.pages().find((each) => each.tab === tab) ?? null;
  const wanted = (tab: Id<"tab">) =>
    [...leases.values()].some((lease) => lease.tab === tab);

  // host가 아는 것을 lease들이 원하는 것에 맞춘다. 진행 중이면 끝난 뒤 다시 맞춘다(켜고 끄는 순서가 뒤집히지 않게).
  function sync(tab: Id<"tab">): Promise<Result<unknown>> {
    const running = flying.get(tab);
    if (running !== undefined) return running.then(() => sync(tab));
    const want = wanted(tab);
    if (sent.has(tab) === want) return Promise.resolve(ok({}));
    const call = deps
      .call({ kind: "page_stream", payload: { tab, on: want } })
      .then((done) => {
        flying.delete(tab);
        if (done.ok) {
          if (want) sent.add(tab);
          else sent.delete(tab);
        }
        return done;
      });
    flying.set(tab, call);
    return call;
  }

  function drop(tab: Id<"tab">) {
    for (const [key, lease] of leases) {
      if (lease.tab === tab) leases.delete(key);
    }
    views.delete(tab);
    keys.delete(tab);
    sent.delete(tab);
  }

  // lease가 있는 탭의 frame이나 상태를 바꾸고 알린다. lease가 없거나 표에 없는 탭이면 버린다.
  function change(tab: Id<"tab">, apply: (view: View) => void): void {
    if (!wanted(tab) || page(tab) === null) return;
    let view = views.get(tab);
    if (view === undefined) {
      view = {
        seq: 0,
        frame: null,
        hostSeq: 0,
        read: null,
        painting: true,
        agent: false,
        held: false,
      };
      views.set(tab, view);
    }
    apply(view);
    view.seq += 1;
    deps.publish({
      type: "PageViewChanged",
      subject: `page:${tab}`,
      at: deps.clock.now(),
      payload: { tab, seq: view.seq },
    } as BusEvent);
  }

  // url·title을 redaction에 지나게 한다. 못 끝내면 null이다.
  function fields(found: NonNullable<ReturnType<typeof page>>) {
    const state = found.state ?? { url: "", title: "", loading: true };
    const url = deps.redact(state.url);
    const title = deps.redact(state.title);
    if (url === null || title === null) return null;
    return {
      url,
      title,
      loading: state.loading,
      by: found.owner === "person" ? null : nameOf(found.owner),
    };
  }

  return {
    list(who: Who) {
      if (who.actor !== "user") return notUser();
      const pages = [];
      for (const found of deps.pages()) {
        const shown = fields(found);
        if (shown === null) {
          return err({ code: "unavailable" as const, message: UNCHECKED });
        }
        pages.push({ tab: found.tab, ...shown });
      }
      return ok({ pages });
    },

    // 내준 frame의 host seq를 아직 `page_read`로 알리지 않았으면 알린다(host가 다음 frame을 보내도 된다는 신호).
    snapshot(who: Who, tab: Id<"tab">) {
      if (who.actor !== "user") return notUser();
      const found = page(tab);
      if (found === null) return gone();
      const shown = fields(found);
      if (shown === null) {
        return err({ code: "unavailable" as const, message: UNCHECKED });
      }
      const view = views.get(tab);
      // host가 다시 뜨면 seq가 처음부터일 수 있어 크기가 아니라 다름을 본다.
      if (
        view !== undefined &&
        view.frame !== null &&
        view.read !== view.hostSeq
      ) {
        view.read = view.hostSeq;
        void deps.call({
          kind: "page_read",
          payload: { tab, seq: view.hostSeq },
        });
      }
      return ok({
        tab,
        seq: view?.seq ?? 0,
        frame: view?.frame ?? null,
        painting: view?.painting ?? true,
        agent: view?.agent ?? false,
        held: view?.held ?? false,
        ...shown,
        control: deps.mayControl(who.principal),
      });
    },

    // 켜면 lease를 만들거나 갱신하고, 끄면 거둔다. host에 닿지 않아도 lease는 남아 다시 연결될 때 켠다.
    async watch(
      who: Who,
      input: { tab: Id<"tab">; on: boolean },
    ): Promise<Result<Record<string, never>>> {
      if (who.actor !== "user") return notUser();
      const { tab } = input;
      const key = `${who.principal}\n${tab}`;
      if (!input.on) {
        leases.delete(key);
        if (!wanted(tab)) views.delete(tab);
        void sync(tab);
        return ok({});
      }
      if (page(tab) === null) return gone();
      leases.set(key, {
        tab,
        expiresAt: deps.clock.nowMs() + PAGE_VIEW_LEASE_MS,
      });
      const done = await sync(tab);
      return done.ok ? ok({}) : err(passed(done.error));
    },

    // 허락 확인은 부른 쪽이 아니라 여기서 한다. 좌표는 본 frame에 대한 것이라 lease가 있어야 한다. 같은 key는 탭마다 200개를 기억한다.
    async input(
      who: Who,
      input: { tab: Id<"tab">; key: string; input: PageInput },
    ): Promise<Result<Record<string, never>>> {
      if (who.actor !== "user") return notUser();
      if (!deps.mayControl(who.principal)) return mayNot();
      const { tab } = input;
      if (page(tab) === null) return gone();
      if (!leases.has(`${who.principal}\n${tab}`)) {
        return err({
          code: "conflict" as const,
          message: "Watch the page before sending input to it.",
        });
      }
      let table = keys.get(tab);
      if (table === undefined) keys.set(tab, (table = new Map()));
      const done = await once(table, input.key, () =>
        deps.call({ kind: "page_input", payload: { tab, input: input.input } }),
      );
      return done.ok ? ok({}) : err(passed(done.error));
    },

    async control(
      who: Who,
      input: { tab: Id<"tab">; held: boolean },
    ): Promise<Result<Record<string, never>>> {
      if (who.actor !== "user") return notUser();
      if (!deps.mayControl(who.principal)) return mayNot();
      const { tab } = input;
      if (page(tab) === null) return gone();
      const done = await deps.call({
        kind: "page_control",
        payload: { tab, held: input.held },
      });
      return done.ok ? ok({}) : err(passed(done.error));
    },

    // 같은 key는 한 번만 연다(보내는 중이거나 성공한 것의 답을 준다).
    open(
      who: Who,
      input: { url: string; key: string },
    ): Promise<Result<{ tab: Id<"tab"> }>> {
      if (who.actor !== "user") return Promise.resolve(notUser());
      if (!deps.mayControl(who.principal)) return Promise.resolve(mayNot());
      return once(opens, input.key, () => deps.open(who, input.url));
    },

    frame(frame: HostFrameOf<"page_frame">): void {
      change(frame.tab as Id<"tab">, (view) => {
        view.frame = frame.frame;
        view.hostSeq = frame.seq;
      });
    },

    state(frame: HostFrameOf<"page_state">): void {
      change(frame.tab as Id<"tab">, (view) => {
        view.painting = frame.painting;
        view.agent = frame.agent;
        view.held = frame.held;
      });
    },

    // 기한이 지난 lease를 거둔다(주기로 부른다).
    expire(): void {
      const now = deps.clock.nowMs();
      const touched = new Set<Id<"tab">>();
      for (const [key, lease] of leases) {
        if (lease.expiresAt <= now) {
          leases.delete(key);
          touched.add(lease.tab);
        }
      }
      for (const tab of touched) {
        if (!wanted(tab)) views.delete(tab);
        void sync(tab);
      }
    },

    // browser 탭 표가 바뀌었다. 표에서 빠진 탭의 lease·frame·key와 남은 탭이 없는 session의 이름을 지운다.
    pruned(): void {
      const pages = deps.pages();
      const known = new Set(pages.map((each) => each.tab));
      const owners = new Set<string>(pages.map((each) => each.owner));
      for (const session of names.keys()) {
        if (!owners.has(session)) names.delete(session);
      }
      const all = new Set([
        ...views.keys(),
        ...sent,
        ...keys.keys(),
        ...[...leases.values()].map((lease) => lease.tab),
      ]);
      for (const tab of all) {
        if (!known.has(tab)) drop(tab);
      }
    },

    // 연결이 닫혔다. host는 frame을 밀던 것을 잃는다.
    closed(): void {
      sent.clear();
    },

    // 연결이 다시 열렸다. 살아 있는 lease마다 다시 켠다.
    opened(): void {
      for (const tab of new Set([...leases.values()].map((l) => l.tab))) {
        void sync(tab);
      }
    },
  };
}

export type PageView = ReturnType<typeof createPageView>;
