import {
  err,
  ok,
  type Clock,
  type IdSource,
  type Result,
} from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import type {
  BrowserTabState,
  HostRequest,
  HostTabTarget,
  HostWorkspace,
  TabPlace,
} from "../../protocol/lophn-agent/host-queue.ts";

// core 메모리의 host queue와 agent가 연 탭의 표다. 꺼지면 사라진다.
// shell main이 1초마다 가져가므로(`take`) 마지막 take가 ATTACHED_MS 안이면 shell이 붙어 있다고 본다.
// 빌려 간 요청은 shell main이 죽어 done이 오지 않아도 BORROW_MS 뒤 다시 대기한다.
const ATTACHED_MS = 3_000;
const BORROW_MS = 10_000;
// shell이 없을 때 agent가 되풀이해도 메모리가 끝없이 늘지 않게 한다.
const PENDING_MAX = 200;

type Entry = { request: HostRequest; borrowedAt: number | null };
type TabEntry = {
  opener: Id<"ses"> | null;
  workspace: HostWorkspace;
  kind: "agent" | "browser";
  state: BrowserTabState | null;
};

// 뒤 task(surf-team, ext-tools)가 쓰는 port다.
export type HostQueue = {
  enqueue(request: HostRequest): void;
  // 탭 표에 올리고 tab_open 요청을 넣는다.
  openTab(input: {
    opener: Id<"ses"> | null;
    workspace: HostWorkspace;
    target: HostTabTarget;
    place: TabPlace | null;
    source: Id<"ses"> | null;
    // target이 tui일 때 CLI를 다시 여는 값.
    resume?: { harness: string; external_session: string };
  }): Id<"tab">;
  // 마지막 take가 3초 안이다.
  attached(): boolean;
};

const sameWorkspace = (a: HostWorkspace, b: HostWorkspace) =>
  a.kind === b.kind && (a.kind === "home" || a.id === (b as typeof a).id);

export function createHostQueue(deps: { clock: Clock; ids: IdSource }) {
  const pending: Entry[] = [];
  const tabs = new Map<Id<"tab">, TabEntry>();
  let lastTakeMs: number | null = null;

  function enqueue(request: HostRequest): void {
    pending.push({ request, borrowedAt: null });
    if (pending.length > PENDING_MAX) pending.shift();
  }

  // 자기가 연 탭만 다룬다. 없는 탭과 남의 탭은 다르게 답한다(close: forbidden, read: not_found).
  function owned(tab: Id<"tab">, caller: Id<"ses">, missing: "close" | "read") {
    const entry = tabs.get(tab);
    if (entry === undefined) {
      return err({ code: "not_found" as const, message: "tab not found" });
    }
    if (entry.opener !== caller) {
      return missing === "close"
        ? err({
            code: "forbidden" as const,
            message: "only the session that opened the tab can close it",
          })
        : err({ code: "not_found" as const, message: "tab not found" });
    }
    return ok(entry);
  }

  return {
    enqueue,
    attached: () =>
      lastTakeMs !== null && deps.clock.nowMs() - lastTakeMs <= ATTACHED_MS,
    openTab(input: Parameters<HostQueue["openTab"]>[0]) {
      const tab = deps.ids.newId("tab") as Id<"tab">;
      tabs.set(tab, {
        opener: input.opener,
        workspace: input.workspace,
        kind: "browser" in input.target ? "browser" : "agent",
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
    take(workspaces: readonly HostWorkspace[]): HostRequest | null {
      const now = deps.clock.nowMs();
      lastTakeMs = now;
      const found = pending.find(
        (entry) =>
          (entry.borrowedAt === null || now - entry.borrowedAt > BORROW_MS) &&
          workspaces.some((workspace) =>
            sameWorkspace(workspace, entry.request.workspace),
          ),
      );
      if (found === undefined) return null;
      found.borrowedAt = now;
      return found.request;
    },
    done(id: Id<"hrq">, result: "done" | "retry"): void {
      const at = pending.findIndex((entry) => entry.request.id === id);
      if (at < 0) return;
      const [entry] = pending.splice(at, 1);
      // 못 여는 요청이 앞에서 뒤 요청을 막지 않게 retry는 맨 뒤로 보낸다.
      if (result === "retry") {
        entry!.borrowedAt = null;
        pending.push(entry!);
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
    close(tab: Id<"tab">, caller: Id<"ses">): Result<Id<"tab">> {
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
    read(tab: Id<"tab">, caller: Id<"ses">): Result<BrowserTabState> {
      const found = owned(tab, caller, "read");
      if (!found.ok) return found;
      return found.value.kind === "browser" && found.value.state !== null
        ? ok(found.value.state)
        : err({ code: "not_found", message: "tab has no browser state" });
    },
  };
}

export type HostQueueService = ReturnType<typeof createHostQueue>;
