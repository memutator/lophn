// core의 view 표. host(shell main, 폰)가 연 앱 화면마다 (owner, view) 한 줄로 어느 앱·release·process에 묶였는지 쥔다.
// 신원은 host가 붙인 view id와 요청 credential의 principal(owner)이다. 화면 page가 낸 값은 신원이 아니다.
// 표는 메모리에만 있다. core가 다시 뜨면 비고, host가 `open`을 다시 불러 되살린다.
import {
  canonicalize,
  err,
  type LophnError,
  ok,
  type Result,
} from "../../../base/mod.ts";
import { validateInput } from "../../../protocol/apps/declaration/mod.ts";
import type {
  InputSchema,
  SubscriptionDeclaration,
} from "../../../protocol/apps/declaration/mod.ts";
import type { JsonObject } from "../../../protocol/base/json-values.ts";
import type {
  AppViewEventPayload,
  AppViewsOpenInput,
  AppViewsOpenOutput,
} from "../../../protocol/apps/views.ts";
import type { AppViewsPorts, ReleaseView } from "./ports.ts";

/** owner마다 열어 둘 수 있는 view 수. 넘으면 가장 오래 쓰지 않은 view를 내보낸다. */
export const VIEWS_PER_OWNER = 64;

type LostReason = Extract<AppViewEventPayload, { kind: "lost" }>["reason"];

export type ViewArgs = Omit<AppViewsOpenInput, "view">;

export interface ViewBinding {
  release: string | null;
  bundle_hash: string;
  process_nonce: string;
}

export interface ViewEntry {
  owner: string;
  view: string;
  /** 처음 받은 인자 그대로. 같은 (owner, view)의 다시 열기는 이것과 같아야 한다(card가 아닌 live view의 release는 빼고 본다). */
  args: ViewArgs;
  binding: ViewBinding;
  /** 선언의 params schema를 통과한 값. 주지 않았으면 null. */
  params: JsonObject | null;
  /** 묶인 release가 선언한 구독. preview view는 비어 있다(앱 event를 받지 않는다). */
  subscriptions: readonly SubscriptionDeclaration[];
  /** 다시 묶지 못한 이유. 묶여 있으면 null. */
  lost: LostReason | null;
  /** LRU 순서. open·call·event가 닿을 때 오른다. */
  used: number;
}

type BindFailure =
  | { reason: "missing" | "archived" | "stopped" | "conflict"; message: string }
  | { reason: "error"; error: LophnError };

type Bound = { binding: ViewBinding; declaration: ReleaseView | null };

function keyOf(owner: string, view: string): string {
  return `${owner}\u0000${view}`;
}

function errorOf(failure: BindFailure): LophnError {
  switch (failure.reason) {
    case "missing":
      return { code: "not_found", message: failure.message };
    case "conflict":
      return { code: "conflict", message: failure.message };
    case "error":
      return failure.error;
    default:
      return { code: "unavailable", message: failure.message };
  }
}

function lostOf(failure: BindFailure): LostReason {
  switch (failure.reason) {
    case "archived":
      return "app_archived";
    case "conflict":
      return "conflict";
    default:
      return "app_stopped";
  }
}

export function createViewTable(ports: AppViewsPorts) {
  const entries = new Map<string, ViewEntry>();
  let tick = 0;

  function touch(entry: ViewEntry): void {
    tick += 1;
    entry.used = tick;
  }

  /**
   * 앱의 지금 process에 묶는다. `want`가 있으면 그 release여야 한다(아니면 conflict). live는 도는 release의 선언을,
   * preview는 release가 있을 때만 그 선언을 같이 읽는다.
   */
  async function resolve(
    args: ViewArgs,
    want: string | null,
  ): Promise<{ ok: true; value: Bound } | { ok: false; failure: BindFailure }> {
    const fail = (failure: BindFailure) => ({ ok: false as const, failure });
    const status = ports.appStatus(args.app);
    if (!status.ok) return fail({ reason: "error", error: status.error });
    if (status.value === null) {
      return fail({ reason: "missing", message: "app not found" });
    }
    if (status.value === "archived") {
      return fail({ reason: "archived", message: "app is archived" });
    }
    if (args.mode === "preview") {
      const found = await ports.preview(args.app);
      if (!found.ok) return fail({ reason: "error", error: found.error });
      if (found.value === null) {
        return fail({ reason: "stopped", message: "preview is not running" });
      }
      if (want !== null && found.value.release !== want) {
        return fail({
          reason: "conflict",
          message: "the preview runs another release",
        });
      }
      let declaration: ReleaseView | null = null;
      if (found.value.release !== null) {
        const read = ports.release(args.app, found.value.release);
        if (!read.ok) return fail({ reason: "error", error: read.error });
        declaration = read.value;
      }
      return {
        ok: true,
        value: {
          binding: {
            release: found.value.release,
            bundle_hash: found.value.bundle_hash,
            process_nonce: found.value.process_nonce,
          },
          declaration,
        },
      };
    }
    const running = await ports.live(args.app);
    if (!running.ok) return fail({ reason: "error", error: running.error });
    if (running.value === null) {
      return fail({ reason: "stopped", message: "app is not running" });
    }
    if (want !== null && running.value.release !== want) {
      return fail({
        reason: "conflict",
        message: "the app now runs another release",
      });
    }
    const read = ports.release(args.app, running.value.release);
    if (!read.ok) return fail({ reason: "error", error: read.error });
    if (read.value === null) {
      return fail({ reason: "stopped", message: "app is not available" });
    }
    return {
      ok: true,
      value: {
        binding: {
          release: running.value.release,
          bundle_hash: read.value.bundle_hash,
          process_nonce: running.value.process_nonce,
        },
        declaration: read.value,
      },
    };
  }

  // 화면은 선언에 있어야 하고 자리는 그 화면의 places에 들어야 한다. params는 그 화면의 schema로 검사해 정규화한다.
  // release 없는 preview는 읽을 선언이 없어 화면·자리 검사를 건너뛰고 params는 받지 않는다.
  function checkScreen(
    args: ViewArgs,
    declaration: ReleaseView | null,
  ): Result<JsonObject | null> {
    if (declaration === null) {
      return args.params === undefined
        ? ok(null)
        : err({
            code: "unavailable",
            message: "the screen declaration is unknown",
          });
    }
    const screen = declaration.screens.find((item) => item.key === args.screen);
    if (screen === undefined) {
      return err({
        code: "invalid_input",
        message: "the app has no such screen",
      });
    }
    if (!screen.places.includes(args.place)) {
      return err({
        code: "invalid_input",
        message: "the screen does not open in this place",
      });
    }
    if (args.params === undefined) return ok(null);
    const checked = validateInput(
      (screen.params ?? null) as InputSchema | null,
      args.params,
    );
    if (!checked.ok) {
      return err({
        code: "invalid_input",
        message: "params do not match the screen",
      });
    }
    return ok((checked.value ?? {}) as JsonObject);
  }

  // card view는 묶인 release에 고정된다. 다른 view는 지금 도는 release(preview는 지금 preview)를 따른다.
  function pinnedRelease(entry: ViewEntry): string | null {
    return entry.args.place === "card" ? entry.binding.release : null;
  }

  // 다시 열기에서 같은 view인지 볼 인자. card가 아닌 live view의 release는 열 때의 전제(그 release가 돌기를 기대한다)이고
  // view는 그 뒤 도는 release를 따르므로 신원이 아니다. card와 preview는 release까지 같아야 한다.
  function identityOf(args: ViewArgs): string {
    return canonicalize(
      args.mode === "live" && args.place !== "card"
        ? { ...args, release: null }
        : args,
    );
  }

  function apply(entry: ViewEntry, bound: Bound): void {
    entry.binding = bound.binding;
    entry.subscriptions =
      entry.args.mode === "live"
        ? (bound.declaration?.subscriptions ?? [])
        : [];
    entry.lost = null;
  }

  function outputOf(entry: ViewEntry): AppViewsOpenOutput {
    return {
      view: entry.view,
      release: entry.binding.release,
      bundle_hash: entry.binding.bundle_hash,
      process_nonce: entry.binding.process_nonce,
      params: entry.params,
    };
  }

  function lose(entry: ViewEntry, reason: LostReason): void {
    entry.lost = reason;
    ports.publish(entry.args.app, {
      owner: entry.owner,
      view: entry.view,
      kind: "lost",
      reason,
    });
  }

  // owner의 view가 상한에 닿았으면 가장 오래 쓰지 않은 것을 내보낸다.
  function makeRoom(owner: string): void {
    let count = 0;
    let oldest: ViewEntry | undefined;
    for (const entry of entries.values()) {
      if (entry.owner !== owner) continue;
      count += 1;
      if (oldest === undefined || entry.used < oldest.used) oldest = entry;
    }
    if (count < VIEWS_PER_OWNER || oldest === undefined) return;
    entries.delete(keyOf(owner, oldest.view));
    lose(oldest, "evicted");
  }

  return {
    async open(
      owner: string,
      input: AppViewsOpenInput,
    ): Promise<Result<AppViewsOpenOutput>> {
      const { view, ...args } = input;
      const key = keyOf(owner, view);
      const existing = entries.get(key);
      if (existing !== undefined) {
        // 같은 인자의 다시 열기(resume)는 지금 binding을 다시 읽어 돌려준다.
        if (identityOf(existing.args) !== identityOf(args)) {
          return err({
            code: "conflict",
            message: "the view is open with other arguments",
          });
        }
        const bound = await resolve(args, pinnedRelease(existing));
        if (!bound.ok) return err(errorOf(bound.failure));
        if (entries.get(key) !== existing) {
          return err({ code: "conflict", message: "the view changed" });
        }
        apply(existing, bound.value);
        touch(existing);
        return ok(outputOf(existing));
      }
      const bound = await resolve(args, args.release);
      if (!bound.ok) return err(errorOf(bound.failure));
      const params = checkScreen(args, bound.value.declaration);
      if (!params.ok) return params;
      const raced = entries.get(key);
      if (raced !== undefined && identityOf(raced.args) !== identityOf(args)) {
        return err({
          code: "conflict",
          message: "the view is open with other arguments",
        });
      }
      if (raced === undefined) makeRoom(owner);
      const entry: ViewEntry = {
        owner,
        view,
        args,
        binding: bound.value.binding,
        params: params.value,
        subscriptions: [],
        lost: null,
        used: 0,
      };
      apply(entry, bound.value);
      touch(entry);
      entries.set(key, entry);
      return ok(outputOf(entry));
    },

    /** 다른 owner의 view와 없는 view는 같다(undefined). */
    get(owner: string, view: string): ViewEntry | undefined {
      return entries.get(keyOf(owner, view));
    },

    close(owner: string, view: string): boolean {
      return entries.delete(keyOf(owner, view));
    },

    /** host가 owner의 연결을 잃었다. 그 owner의 view를 모두 지운다. 받을 곳이 없으니 event는 내지 않는다. */
    closeOwner(owner: string): void {
      for (const [key, entry] of entries) {
        if (entry.owner === owner) entries.delete(key);
      }
    },

    touch,

    entries(): IterableIterator<ViewEntry> {
      return entries.values();
    },

    /**
     * `AppViewChanged`. 그 앱의 모든 view를 다시 묶고 view마다 `rebound`(binding이 그대로여도) 또는 `lost`를 낸다.
     * lost view는 표에 남아 다음 변경이나 다시 열기로 되살아난다.
     */
    async rebind(app: string): Promise<void> {
      const targets = [...entries.values()].filter(
        (entry) => entry.args.app === app,
      );
      await Promise.all(
        targets.map(async (entry) => {
          const bound = await resolve(entry.args, pinnedRelease(entry));
          if (entries.get(keyOf(entry.owner, entry.view)) !== entry) return;
          if (!bound.ok) return lose(entry, lostOf(bound.failure));
          apply(entry, bound.value);
          ports.publish(app, {
            owner: entry.owner,
            view: entry.view,
            kind: "rebound",
            release: entry.binding.release,
            bundle_hash: entry.binding.bundle_hash,
            process_nonce: entry.binding.process_nonce,
          });
        }),
      );
    },
  };
}

export type ViewTable = ReturnType<typeof createViewTable>;
