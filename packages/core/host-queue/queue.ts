import {
  err,
  ok,
  type Clock,
  type IdSource,
  type Result,
} from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import type { ExtensionToolContent } from "../../protocol/extensions/manifest.ts";
import {
  BROWSER_CALL_MS,
  type BrowserTabState,
  HOST_TAKE_WAIT_MS,
  type HostRequest,
  type HostTabTarget,
  type HostToolOutput,
  type HostWorkspace,
  type TabPlace,
} from "../../protocol/lophn-agent/host-queue.ts";

// core 메모리의 host queue와 agent가 연 탭의 표다. 꺼지면 사라진다.
// shell main이 `take`를 이어 부르므로(long-poll) 기다리는 take가 있거나 마지막 take가 끝난 지 ATTACHED_MS 안이면 shell이 붙어 있다고 본다.
// 빌려 간 요청은 shell main이 죽어 done이 오지 않아도 BORROW_MS 뒤 다시 대기한다.
const ATTACHED_MS = 3_000;
const BORROW_MS = 10_000;
// shell이 없을 때 agent가 되풀이해도 메모리가 끝없이 늘지 않게 한다.
const PENDING_MAX = 200;

type Entry = { request: HostRequest; borrowedAt: number | null };
// 탭의 주인이다. 사람 token은 모두 같은 주인 "person"이다.
export type TabOwner = Id<"ses"> | "person";
type TabEntry = {
  owner: TabOwner;
  workspace: HostWorkspace;
  kind: "agent" | "browser" | "preview";
  // preview 탭이 따르는 앱. 앱마다 탭 하나라 이걸로 찾는다.
  app: string | null;
  state: BrowserTabState | null;
};

type ToolCallPayload = Extract<HostRequest, { kind: "tool_call" }>["payload"];
type BrowserCallPayload = Extract<
  HostRequest,
  { kind: "browser_call" }
>["payload"];
type CallResult = Result<ExtensionToolContent[]>;

// 뒤 task(surf-team, ext-tools)가 쓰는 port다.
export type HostQueue = {
  enqueue(request: HostRequest): void;
  // extension tool 호출을 넣고 shell main의 handler 결과를 기다린다. `abandon(id)`로 거두면 `unavailable`로 끝난다.
  callTool(payload: ToolCallPayload): {
    id: Id<"hrq">;
    result: Promise<CallResult>;
  };
  // browser 호출을 넣고 shell main의 결과를 기다린다. BROWSER_CALL_MS 안에 답이 없으면 `expire()`가 거두고 `unavailable`로 끝낸다.
  callBrowser(payload: BrowserCallPayload): {
    id: Id<"hrq">;
    result: Promise<CallResult>;
  };
  abandon(id: Id<"hrq">, message?: string): void;

  // 탭 표에 올리고 tab_open 요청을 넣는다. 그 앱의 preview 탭이 이미 있으면 새로 넣지 않고 그 탭의 주인만 바꿔 돌려준다.
  openTab(input: {
    owner: TabOwner;
    workspace: HostWorkspace;
    target: HostTabTarget;
    place: TabPlace | null;
    source: Id<"ses"> | null;
    // target이 tui일 때 CLI를 다시 여는 값.
    resume?: { harness: string; external_session: string };
  }): Id<"tab">;
  // 기다리는 take가 있거나 마지막 take가 끝난 지 3초 안이다.
  attached(): boolean;
};

const sameWorkspace = (a: HostWorkspace, b: HostWorkspace) =>
  a.kind === b.kind && (a.kind === "home" || a.id === (b as typeof a).id);

// tool_call·browser_call은 workspace를 가리지 않아 아무 shell main이 가져가고, 빌려 가면 done이 올 때까지 다시 내놓지 않는다.
const isCall = (request: HostRequest) =>
  request.kind === "tool_call" || request.kind === "browser_call";

const reachable = (
  request: HostRequest,
  workspaces: readonly HostWorkspace[],
) =>
  isCall(request) ||
  workspaces.some((workspace) => sameWorkspace(workspace, request.workspace));

const unavailable = (message: string) =>
  err({ code: "unavailable" as const, message });

export function createHostQueue(deps: { clock: Clock; ids: IdSource }) {
  const pending: Entry[] = [];
  const tabs = new Map<Id<"tab">, TabEntry>();
  // 결과를 기다리는 tool_call·browser_call. deadline이 null이면 기한이 없다.
  const waiting = new Map<
    Id<"hrq">,
    { resolve: (result: CallResult) => void; deadline: number | null }
  >();
  // 요청을 기다리며 걸려 있는 take.
  const takers = new Set<{
    workspaces: readonly HostWorkspace[];
    finish(request: HostRequest | null): void;
  }>();
  let lastTakeMs: number | null = null;

  function settle(id: Id<"hrq">, result: CallResult) {
    const found = waiting.get(id);
    waiting.delete(id);
    found?.resolve(result);
  }

  // 그 workspace들이 닿는, 빌려 가지 않은 가장 오래된 요청을 빌려 준다.
  function lend(workspaces: readonly HostWorkspace[]): HostRequest | null {
    const now = deps.clock.nowMs();
    const found = pending.find(
      (entry) =>
        (entry.borrowedAt === null ||
          (!isCall(entry.request) && now - entry.borrowedAt > BORROW_MS)) &&
        reachable(entry.request, workspaces),
    );
    if (found === undefined) return null;
    found.borrowedAt = now;
    return found.request;
  }

  function call(
    request: HostRequest,
    deadline: number | null,
  ): { id: Id<"hrq">; result: Promise<CallResult> } {
    const result = new Promise<CallResult>((resolve) => {
      waiting.set(request.id as Id<"hrq">, { resolve, deadline });
    });
    enqueue(request);
    return { id: request.id as Id<"hrq">, result };
  }

  function abandon(id: Id<"hrq">, message = "the shell is not attached") {
    const at = pending.findIndex((entry) => entry.request.id === id);
    if (at >= 0) pending.splice(at, 1);
    settle(id, unavailable(message));
  }

  function take(workspaces: readonly HostWorkspace[]): HostRequest | null {
    lastTakeMs = deps.clock.nowMs();
    return lend(workspaces);
  }

  function enqueue(request: HostRequest): void {
    pending.push({ request, borrowedAt: null });
    for (const taker of [...takers]) {
      const lent = lend(taker.workspaces);
      if (lent !== null) taker.finish(lent);
    }
    if (pending.length > PENDING_MAX) {
      const [dropped] = pending.splice(0, 1);
      settle(
        dropped!.request.id as Id<"hrq">,
        unavailable("host queue is full"),
      );
    }
  }

  // 자기가 연 탭만 다룬다. 없는 탭과 남의 탭은 다르게 답한다(close: forbidden, read: not_found).
  function owned(tab: Id<"tab">, caller: TabOwner, missing: "close" | "read") {
    const entry = tabs.get(tab);
    if (entry === undefined) {
      return err({ code: "not_found" as const, message: "tab not found" });
    }
    if (entry.owner !== caller) {
      return missing === "close"
        ? err({
            code: "forbidden" as const,
            message: "only the caller that opened the tab can close it",
          })
        : err({ code: "not_found" as const, message: "tab not found" });
    }
    return ok(entry);
  }

  return {
    enqueue,
    callTool(payload: ToolCallPayload) {
      const id = deps.ids.newId("hrq") as Id<"hrq">;
      return call({ id, kind: "tool_call", payload }, null);
    },
    callBrowser(payload: BrowserCallPayload) {
      const id = deps.ids.newId("hrq") as Id<"hrq">;
      return call(
        { id, kind: "browser_call", payload },
        deps.clock.nowMs() + BROWSER_CALL_MS,
      );
    },
    abandon,
    // 기한이 지난 browser 호출을 거둔다. 부른 쪽이 주기로 부른다.
    expire(): void {
      const now = deps.clock.nowMs();
      for (const [id, found] of [...waiting]) {
        if (found.deadline !== null && found.deadline <= now) {
          abandon(id, "the browser call timed out");
        }
      }
    },
    // 자기가 연 browser·preview 탭이다. 없는 탭, 남의 탭, session·agent 탭은 `not_found`다.
    browserTab(tab: Id<"tab">, caller: TabOwner) {
      const found = owned(tab, caller, "read");
      if (!found.ok) return found;
      return found.value.kind === "browser" || found.value.kind === "preview"
        ? ok({ view: found.value.kind })
        : err({ code: "not_found" as const, message: "tab not found" });
    },
    attached: () =>
      takers.size > 0 ||
      (lastTakeMs !== null && deps.clock.nowMs() - lastTakeMs <= ATTACHED_MS),
    // 있으면 바로, 없으면 요청이 들어올 때까지 기다리다 HOST_TAKE_WAIT_MS 뒤 null이다. 기다리는 동안 attached다.
    wait(workspaces: readonly HostWorkspace[]): Promise<HostRequest | null> {
      const found = take(workspaces);
      if (found !== null) return Promise.resolve(found);
      return new Promise((resolve) => {
        const timer = setTimeout(() => taker.finish(null), HOST_TAKE_WAIT_MS);
        const taker = {
          workspaces,
          finish(request: HostRequest | null) {
            if (!takers.delete(taker)) return;
            clearTimeout(timer);
            lastTakeMs = deps.clock.nowMs();
            resolve(request);
          },
        };
        takers.add(taker);
      });
    },
    // 기다리는 take를 null로 끝낸다. core가 멈출 때 부른다.
    releaseTakers(): void {
      for (const taker of [...takers]) taker.finish(null);
    },
    openTab(input: Parameters<HostQueue["openTab"]>[0]) {
      const app = "preview" in input.target ? input.target.preview.app : null;
      if (app !== null) {
        for (const [id, entry] of tabs) {
          if (entry.app === app) {
            entry.owner = input.owner;
            return id;
          }
        }
      }
      const tab = deps.ids.newId("tab") as Id<"tab">;
      tabs.set(tab, {
        owner: input.owner,
        workspace: input.workspace,
        kind:
          app !== null
            ? "preview"
            : "browser" in input.target
              ? "browser"
              : "agent",
        app,
        state: null,
      });
      enqueue({
        id: deps.ids.newId("hrq") as Id<"hrq">,
        kind: "tab_open",
        workspace: input.workspace,
        payload: {
          tab,
          target: input.target,
          place: input.place,
          source: input.source,
          resume: input.resume ?? null,
        },
      });
      return tab;
    },
    take,
    done(
      id: Id<"hrq">,
      result: "done" | "retry",
      output?: HostToolOutput,
    ): void {
      const at = pending.findIndex((entry) => entry.request.id === id);
      if (at < 0) return;
      const [entry] = pending.splice(at, 1);
      // 못 여는 요청이 앞에서 뒤 요청을 막지 않게 retry는 맨 뒤로 보낸다.
      if (result === "retry") {
        entry!.borrowedAt = null;
        pending.push(entry!);
        return;
      }
      if (isCall(entry!.request)) {
        settle(
          id,
          output === undefined
            ? unavailable("the shell returned no result")
            : "content" in output
              ? ok(output.content)
              : err(output.error),
        );
      }
    },
    // renderer가 host 탭의 상태나 닫힘을 알린다. 모르는 탭은 무시한다.
    report(tab: Id<"tab">, state: BrowserTabState | "closed"): void {
      if (state === "closed") tabs.delete(tab);
      else {
        const entry = tabs.get(tab);
        if (entry !== undefined) entry.state = state;
      }
    },
    close(tab: Id<"tab">, caller: TabOwner): Result<Id<"tab">> {
      const found = owned(tab, caller, "close");
      if (!found.ok) return found;
      tabs.delete(tab);
      enqueue({
        id: deps.ids.newId("hrq") as Id<"hrq">,
        kind: "tab_close",
        workspace: found.value.workspace,
        payload: { tab },
      });
      return ok(tab);
    },
    read(tab: Id<"tab">, caller: TabOwner): Result<BrowserTabState> {
      const found = owned(tab, caller, "read");
      if (!found.ok) return found;
      return found.value.kind === "browser" && found.value.state !== null
        ? ok(found.value.state)
        : err({ code: "not_found", message: "tab has no browser state" });
    },
  };
}

export type HostQueueService = ReturnType<typeof createHostQueue>;
