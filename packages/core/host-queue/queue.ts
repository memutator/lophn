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
  EXTENSION_TOOL_CALL_MS,
  type BrowserTabState,
  HOST_TAKE_WAIT_MS,
  type HostRequest,
  type HostTabTarget,
  type HostToolOutput,
  type HostWorkspace,
  type TabRelation,
} from "../../protocol/lophn-agent/host-queue.ts";

// core 메모리의 host queue와 agent가 연 탭의 표다. 꺼지면 사라진다.
// shell main이 `take`를 이어 부르므로(long-poll) 기다리는 take가 있거나 마지막 take가 끝난 지 ATTACHED_MS 안이면 shell이 붙어 있다고 본다.
// 빌려 간 요청은 shell main이 죽어 done이 오지 않아도 BORROW_MS 뒤 다시 대기한다.
const ATTACHED_MS = 3_000;
const BORROW_MS = 10_000;
// browser 탭을 열 때 shell이 page를 만들었다고 알릴 때까지 기다리는 기한이다. 넘으면 거두고 `unavailable`이다.
// shell이 없어 띄워야 했던 열기는 앱 시작과 창 열기까지 걸려 START_WAIT_MS 하나로 끝낸다. 한 번 띄운 뒤 그 시간 안에는 다시 띄우지 않는다.
const OPEN_WAIT_MS = 10_000;
const START_WAIT_MS = 30_000;
// shell을 띄우지 못한 뒤(기한, spawn 오류) 이만큼은 다시 띄우지 않고 열기를 바로 실패시킨다. 붙으면 풀린다.
const RETRY_BACKOFF_MS = 5 * 60_000;
// shell이 없을 때 agent가 되풀이해도 메모리가 끝없이 늘지 않게 한다.
const PENDING_MAX = 200;

type Entry = {
  request: HostRequest;
  borrowedAt: number | null;
  anywhere: boolean;
};
// 탭의 주인이다. 사람 token은 모두 같은 주인 "person"이다.
export type TabOwner = Id<"ses"> | "person";
type TabEntry = {
  owner: TabOwner;
  workspace: HostWorkspace;
  kind: "agent" | "browser" | "preview" | "artifact";
  // preview 탭은 앱마다, artifact 탭은 artifact마다 하나라 이 key로 찾는다. 다른 탭은 null이다.
  single: string | null;
  state: BrowserTabState | null;
};

type ToolCallPayload = Extract<HostRequest, { kind: "tool_call" }>["payload"];
type BrowserCallPayload = Extract<
  HostRequest,
  { kind: "browser_call" }
>["payload"];
type TerminalInterruptPayload = Extract<
  HostRequest,
  { kind: "terminal_interrupt" }
>["payload"];
type CallResult = Result<ExtensionToolContent[]>;

// 뒤 task(surf-team, ext-tools)가 쓰는 port다.
export type HostQueue = {
  enqueue(request: HostRequest): void;
  // extension tool 호출을 넣고 shell main의 handler 결과를 기다린다. EXTENSION_TOOL_CALL_MS 안에 답이 없으면 `expire()`가 거두고, `abandon(id)`로 거둬도 `unavailable`로 끝난다.
  callTool(payload: ToolCallPayload): {
    id: Id<"hrq">;
    result: Promise<CallResult>;
  };
  // browser 호출을 넣고 shell main의 결과를 기다린다. BROWSER_CALL_MS 안에 답이 없으면 `expire()`가 거두고 `unavailable`로 끝낸다.
  callBrowser(payload: BrowserCallPayload): {
    id: Id<"hrq">;
    result: Promise<CallResult>;
  };
  // 터미널 탭의 coding agent를 끊는 요청을 넣고 shell main의 결과를 기다린다. shell이 없거나 기한(TERMINAL_INTERRUPT_MS)이 지나면 `unavailable`이다.
  callTerminalInterrupt(payload: TerminalInterruptPayload): {
    id: Id<"hrq">;
    result: Promise<CallResult>;
  };
  abandon(id: Id<"hrq">, message?: string): void;
  // 기한이 지난 호출(extension tool, browser 등)을 거둔다. 부른 쪽이 주기로 부른다.
  expire(): void;
  // 자기가 연 browser·preview·artifact 탭의 종류. 없는 탭, 남의 탭, session·agent 탭은 `not_found`다.
  browserTab(
    tab: Id<"tab">,
    caller: TabOwner,
  ): Result<{ view: "browser" | "preview" | "artifact" }>;

  // 탭 표에 올리고 tab_open 요청을 넣는다. 그 앱의 preview 탭이나 그 artifact의 탭이 이미 있으면 새로 만들지 않고 그 탭의 주인만 바꿔
  // 돌려준다(preview에 기기가 있으면 같은 탭 id로 tab_open을 다시 넣는다).
  openTab(input: OpenInput): Id<"tab">;
  // browser 탭을 열고 shell이 page를 만들었다고 done으로 답할 때까지 기다린다. shell이 붙어 있으면 OPEN_WAIT_MS, 아니면 START_WAIT_MS
  // 안에 답이 없을 때 `expire()`가 거두고 `unavailable`로 끝낸다. 탭은 표에 올라가 있으므로 실패하면 부른 쪽이 `close()`로 거둔다.
  openAndWait(input: OpenInput): {
    tab: Id<"tab">;
    id: Id<"hrq">;
    result: Promise<CallResult>;
  };
  // shell이 붙어 있지 않을 때 `launch`를 불러 띄운다. 띄운 뒤 START_WAIT_MS 안에는 다시 부르지 않고 그 시도를 같이 기다린다.
  // `launch`는 시작이 실패하면 받은 `failed`를 부른다. 지금 shell을 기다려도 되면 true, 앞선 실패의 RETRY_BACKOFF_MS 안이거나
  // 띄우자마자 실패했으면 false다(부른 쪽이 SHELL_START_FAILED로 끝낸다).
  startShell(launch: (failed: () => void) => void): boolean;
  // 아직 쓰지 않은 탭 id다. file을 먼저 쓰고 `openTab({tab})`으로 여는 쪽이 받는다.
  newTabId(): Id<"tab">;
  // 기다리는 take가 있거나 마지막 take가 끝난 지 3초 안이다.
  attached(): boolean;
};

type OpenInput = {
  owner: TabOwner;
  workspace: HostWorkspace;
  target: HostTabTarget;
  relation: TabRelation | null;
  source: Id<"ses"> | null;
  // target이 tui일 때 CLI를 다시 여는 값.
  resume?: { harness: string; external_session: string };
  // target이 coding일 때 handoff 글을 쓴 file이다. `tab`은 그 file 이름에 쓴 `newTabId()`다.
  handoff?: { harness: string; file: string };
  tab?: Id<"tab">;
};

const sameWorkspace = (a: HostWorkspace, b: HostWorkspace) =>
  a.kind === b.kind && (a.kind === "home" || a.id === (b as typeof a).id);

// 결과를 기다리는 요청이다. 빌려 가면 done이 올 때까지 다시 내놓지 않는다(두 번 실행하면 안 된다). tool_call·browser_call과,
// browser 탭의 tab_open(page 만들기를 기다린다)이다.
const isCall = (request: HostRequest) =>
  request.kind === "tool_call" ||
  request.kind === "browser_call" ||
  request.kind === "terminal_interrupt" ||
  (request.kind === "tab_open" && "browser" in request.payload.target);

const unavailable = (message: string) =>
  err({ code: "unavailable" as const, message });

// browser·tab 호출의 이 문장들은 model이 그대로 받는다(work.ts). 원인, 다음 할 일, 되풀이가 통하는지를 적는다.
// 터미널 끊기 요청의 기한이다. key를 치는 일이라 짧다.
const TERMINAL_INTERRUPT_MS = 10_000;
export const SHELL_NOT_ATTACHED =
  "The lophn app is not connected, so there is no browser to use. Retrying does not help until a person opens the lophn app; tell the person.";
const QUEUE_FULL =
  "Too many requests are waiting for the lophn app, so this one was dropped. They wait because the app is not taking them. Retrying may help once the app is running; if it fails again, tell the person.";
const NO_RESULT =
  "The lophn app returned no result for this call. Try once more; if it fails again, tell the person.";
const TIMED_OUT =
  "The browser call timed out before the lophn app answered; the page may be busy or the app stuck. Try once more; if it times out again, tell the person.";
const EXTENSION_TOOL_TIMED_OUT =
  "The extension tool did not answer within 5 minutes, so lophn stopped waiting. It may still be running in the lophn app; check its effect before calling it again, and tell the person if it happens again.";
const OPEN_TIMED_OUT =
  "The browser page did not start loading in time (the site may be slow or not answering), so the tab was not opened. Try `lophn tab open` once more; if it fails again, tell the person.";
export const SHELL_START_FAILED =
  "The lophn app could not be started, so there is no browser to use. Retrying may help once; if it fails again, tell the person.";
// 이미 연 탭에 부른 browser 호출이나 열던 중 shell이 떨어졌을 때다(browser·preview·artifact 탭 모두).
export const SHELL_LOST =
  "The lophn app is not connected, so this tab has no page. Open the tab again with the command you used to open it; if that fails, tell the person.";
// 없는 탭, 닫힌 탭, 남의 탭에 같은 문장을 써서 남의 탭이 있는지 새지 않게 한다.
const NO_SUCH_TAB =
  "No such tab, or it was closed. Open the page again with `lophn tab open`, then use the new tab id.";

export function createHostQueue(deps: { clock: Clock; ids: IdSource }) {
  const pending: Entry[] = [];
  const tabs = new Map<Id<"tab">, TabEntry>();
  // 결과를 기다리는 tool_call·browser_call. deadline이 null이면 기한이 없다.
  const waiting = new Map<
    Id<"hrq">,
    {
      resolve: (result: CallResult) => void;
      deadline: number | null;
      // 기한이 지났을 때 부른 쪽이 받는 문장. 그때의 shell 상태를 본다.
      timedOut: () => string;
      // shell을 띄우며 기다리는 browser 탭 열기. 띄우기가 실패하면 기한 전에 끝낸다.
      starting: boolean;
    }
  >();
  // 요청을 기다리며 걸려 있는 take.
  const takers = new Set<{
    workspaces: readonly HostWorkspace[];
    finish(request: HostRequest | null): void;
  }>();
  let lastTakeMs: number | null = null;
  // 마지막으로 shell을 띄운 때(붙으면 null)와 띄우기가 실패한 때(붙으면 null).
  let launchedAt: number | null = null;
  let failedAt: number | null = null;

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
        (entry.anywhere ||
          workspaces.some((workspace) =>
            sameWorkspace(
              workspace,
              (entry.request as { workspace: HostWorkspace }).workspace,
            ),
          )),
    );
    if (found === undefined) return null;
    found.borrowedAt = now;
    return found.request;
  }

  function call(
    request: HostRequest,
    deadline: number | null,
    timedOut = () => TIMED_OUT,
    starting = false,
  ): { id: Id<"hrq">; result: Promise<CallResult> } {
    const result = new Promise<CallResult>((resolve) => {
      waiting.set(request.id as Id<"hrq">, {
        resolve,
        deadline,
        timedOut,
        starting,
      });
    });
    enqueue(request);
    return { id: request.id as Id<"hrq">, result };
  }

  function abandon(id: Id<"hrq">, message = SHELL_LOST) {
    const at = pending.findIndex((entry) => entry.request.id === id);
    if (at >= 0) {
      const [entry] = pending.splice(at, 1);
      // shell이 열기를 가져간 적이 없으면 page가 없으니 닫으라고 알릴 것도 없다(받는 shell이 없을 때 쌓이지 않게).
      if (entry!.request.kind === "tab_open" && entry!.borrowedAt === null) {
        tabs.delete(entry!.request.payload.tab as Id<"tab">);
      }
    }
    settle(id, unavailable(message));
  }

  // shell을 띄우려던 시도가 실패했다(spawn 오류, 기한). 기다리던 열기는 바로 끝내고 한동안 다시 띄우지 않는다.
  function startFailed(): void {
    launchedAt = null;
    failedAt = deps.clock.nowMs();
    for (const [id, found] of [...waiting]) {
      if (found.starting) abandon(id, SHELL_START_FAILED);
    }
  }

  const attached = () =>
    takers.size > 0 ||
    (lastTakeMs !== null && deps.clock.nowMs() - lastTakeMs <= ATTACHED_MS);

  function take(workspaces: readonly HostWorkspace[]): HostRequest | null {
    lastTakeMs = deps.clock.nowMs();
    launchedAt = null;
    failedAt = null;
    return lend(workspaces);
  }

  // 호출은 workspace를 가리지 않고 아무 take가 가져간다. browser 탭의 page는 그 workspace가 안 보여도 창 단위로 살아서
  // 열기(isCall)와 닫기(close가 anywhere를 준다)도 그렇다.
  function enqueue(request: HostRequest, anywhere = isCall(request)): void {
    pending.push({ request, borrowedAt: null, anywhere });
    for (const taker of [...takers]) {
      const lent = lend(taker.workspaces);
      if (lent !== null) taker.finish(lent);
    }
    if (pending.length > PENDING_MAX) {
      const [dropped] = pending.splice(0, 1);
      settle(dropped!.request.id as Id<"hrq">, unavailable(QUEUE_FULL));
    }
  }

  // 자기가 연 탭만 다룬다. 없는 탭과 남의 탭은 다르게 답한다(close·show: forbidden, read: 같은 not_found 문장).
  function owned(
    tab: Id<"tab">,
    caller: TabOwner,
    missing: "close" | "show" | "read",
  ) {
    const entry = tabs.get(tab);
    if (entry === undefined) {
      return err({
        code: "not_found" as const,
        message: missing === "read" ? NO_SUCH_TAB : "tab not found",
      });
    }
    if (entry.owner !== caller) {
      return missing !== "read"
        ? err({
            code: "forbidden" as const,
            message: `only the caller that opened the tab can ${missing} it`,
          })
        : err({ code: "not_found" as const, message: NO_SUCH_TAB });
    }
    return ok(entry);
  }

  // browser 탭의 page는 shell이 든다. 앱이 끝나면 창이 닫혔다고 알리는 길이 없어 표에 탭이 남으므로, shell이 없을 때 그 탭을 부르면
  // page가 이미 사라진 것으로 보고 표에서 뺀다. preview·artifact 탭은 앱이 다시 뜨면 layout에서 다시 열려 그대로 둔다.
  function pageAlive(tab: Id<"tab">, entry: TabEntry): boolean {
    if (entry.kind !== "browser" || attached()) return true;
    tabs.delete(tab);
    return false;
  }
  const noSuchTab = () =>
    err({ code: "not_found" as const, message: NO_SUCH_TAB });

  // 탭 표에 올리고 tab_open 요청을 넣는다. wait면 shell main이 page를 만들었다고 done으로 답할 때까지 기다리는 result를 같이 준다.
  function place(
    input: OpenInput,
    wait: boolean,
  ): {
    tab: Id<"tab">;
    sent: { id: Id<"hrq">; result: Promise<CallResult> } | null;
  } {
    const { target, workspace } = input;
    const single =
      "preview" in target
        ? `preview:${target.preview.app}`
        : "artifact" in target && workspace.kind !== "home"
          ? `artifact:${workspace.kind}:${workspace.id}:${target.artifact.name}`
          : null;
    const open = (tab: Id<"tab">) => {
      const request: HostRequest = {
        id: deps.ids.newId("hrq") as Id<"hrq">,
        kind: "tab_open",
        workspace: input.workspace,
        payload: {
          tab,
          target: input.target,
          relation: input.relation,
          source: input.source,
          resume: input.resume ?? null,
          handoff: input.handoff ?? null,
        },
      };
      if (!wait) {
        enqueue(request);
        return null;
      }
      // 기한 끝에 shell이 붙어 있지 않으면 띄우지 못한 것이고, 붙어 있으면 page가 안 생긴 것이다.
      const starting = !attached();
      return call(
        request,
        deps.clock.nowMs() + (starting ? START_WAIT_MS : OPEN_WAIT_MS),
        () => (attached() ? OPEN_TIMED_OUT : SHELL_START_FAILED),
        starting,
      );
    };
    if (single !== null) {
      for (const [id, entry] of tabs) {
        if (entry.single === single) {
          entry.owner = input.owner;
          // 이미 열린 탭에 기기를 주면 같은 탭에 기기를 다시 알린다(창이 그 탭의 기기만 바꾼다).
          if (
            "preview" in input.target &&
            input.target.preview.device !== null
          ) {
            open(id);
          }
          return { tab: id, sent: null };
        }
      }
    }
    const tab = input.tab ?? (deps.ids.newId("tab") as Id<"tab">);
    tabs.set(tab, {
      owner: input.owner,
      workspace: input.workspace,
      kind:
        "preview" in target
          ? "preview"
          : "artifact" in target
            ? "artifact"
            : "browser" in target
              ? "browser"
              : "agent",
      single,
      state: null,
    });
    return { tab, sent: open(tab) };
  }

  function done(
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
          ? unavailable(NO_RESULT)
          : "content" in output
            ? ok(output.content)
            : err(output.error),
      );
    }
  }

  return {
    enqueue,
    callTool(payload: ToolCallPayload) {
      const id = deps.ids.newId("hrq") as Id<"hrq">;
      return call(
        { id, kind: "tool_call", payload },
        deps.clock.nowMs() + EXTENSION_TOOL_CALL_MS,
        () => EXTENSION_TOOL_TIMED_OUT,
      );
    },
    callBrowser(payload: BrowserCallPayload) {
      const id = deps.ids.newId("hrq") as Id<"hrq">;
      return call(
        { id, kind: "browser_call", payload },
        deps.clock.nowMs() + BROWSER_CALL_MS,
      );
    },
    callTerminalInterrupt(payload: TerminalInterruptPayload) {
      const id = deps.ids.newId("hrq") as Id<"hrq">;
      return call(
        { id, kind: "terminal_interrupt", payload },
        deps.clock.nowMs() + TERMINAL_INTERRUPT_MS,
        () =>
          "The lophn app did not answer in time, so the terminal was not interrupted.",
      );
    },
    abandon,
    // 기한이 지난 호출을 거둔다. 부른 쪽이 주기로 부른다.
    expire(): void {
      const now = deps.clock.nowMs();
      // 띄운 shell이 기한 안에 붙지 않았다. 같은 시도를 기다리던 열기를 모두 끝낸다.
      if (
        launchedAt !== null &&
        !attached() &&
        now - launchedAt >= START_WAIT_MS
      ) {
        startFailed();
      }
      for (const [id, found] of [...waiting]) {
        if (found.deadline !== null && found.deadline <= now) {
          abandon(id, found.timedOut());
        }
      }
    },
    // 자기가 연 browser·preview·artifact 탭이다. 없는 탭, 남의 탭, session·agent 탭은 `not_found`다.
    browserTab(tab: Id<"tab">, caller: TabOwner) {
      const found = owned(tab, caller, "read");
      if (!found.ok) return found;
      if (!pageAlive(tab, found.value)) return noSuchTab();
      const { kind } = found.value;
      return kind === "agent"
        ? err({ code: "not_found" as const, message: NO_SUCH_TAB })
        : ok({ view: kind });
    },
    attached,
    startShell(launch: (failed: () => void) => void): boolean {
      if (attached()) return true;
      const now = deps.clock.nowMs();
      if (failedAt !== null && now - failedAt < RETRY_BACKOFF_MS) return false;
      if (launchedAt === null || now - launchedAt >= START_WAIT_MS) {
        launchedAt = now;
        launch(startFailed);
      }
      // launch가 바로 실패했으면 startFailed가 비웠다.
      return launchedAt !== null;
    },
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
    newTabId: () => deps.ids.newId("tab") as Id<"tab">,
    openTab: (input: OpenInput) => place(input, false).tab,
    openAndWait(input: OpenInput) {
      const placed = place(input, true);
      return { tab: placed.tab, ...placed.sent! };
    },
    take,
    done,
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
      enqueue(
        {
          id: deps.ids.newId("hrq") as Id<"hrq">,
          kind: "tab_close",
          workspace: found.value.workspace,
          payload: { tab },
        },
        // browser 탭의 page는 그 workspace가 안 보여도 창 단위로 살아 있다.
        found.value.kind === "browser",
      );
      return ok(tab);
    },
    show(tab: Id<"tab">, caller: TabOwner): Result<Id<"tab">> {
      const found = owned(tab, caller, "show");
      if (!found.ok) return found;
      enqueue({
        id: deps.ids.newId("hrq") as Id<"hrq">,
        kind: "tab_show",
        workspace: found.value.workspace,
        payload: { tab },
      });
      return ok(tab);
    },
    read(tab: Id<"tab">, caller: TabOwner): Result<BrowserTabState> {
      const found = owned(tab, caller, "read");
      if (!found.ok) return found;
      if (!pageAlive(tab, found.value)) return noSuchTab();
      return found.value.kind === "browser" && found.value.state !== null
        ? ok(found.value.state)
        : err({ code: "not_found", message: "tab has no browser state" });
    },
  };
}

export type HostQueueService = ReturnType<typeof createHostQueue>;
