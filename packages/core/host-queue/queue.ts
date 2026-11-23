import {
  err,
  ok,
  type Clock,
  type IdSource,
  type Result,
} from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import { PHONE_TAB_TEXT } from "../../protocol/phone/drive.ts";
import {
  BROWSER_CALL_MS,
  type BrowserTabState,
  type HostRequest,
  type HostTabTarget,
  type HostToolContent,
  type HostToolOutput,
  type HostWorkspace,
  LINK_REQUEST_KINDS,
  type LinkRequest,
  type LinkRequestKind,
  type TabListItem,
  type TabRelation,
} from "../../protocol/lophn-agent/host-queue.ts";

// core 메모리의 host queue와 agent가 연 탭의 표다. 꺼지면 사라진다.
// host는 `/host-link` 연결(`connect`)로 붙고 queue가 닿는 요청을 바로 밀어 준다. 연결이 열려 있으면 shell이 붙어 있다.
// 빌려 간 탭 요청은 done이 오지 않으면 BORROW_MS 뒤 다시 나가고, 연결이 닫히면 바로 다시 대기한다.
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
// phone 탭이다. 화면은 폰에 있고 core가 폰 link로 다룬다(`phone.ts`). shell에는 가지 않는다. 기기와 view는 쥐지 않고
// 부를 때마다 고른다. screen이 null이면 폰이 보이는 어느 화면이든이다. last는 마지막 snapshot과 그 ref 표(`eN` → 폰의 node)다.
export type PhoneTab = {
  app: string;
  screen: string | null;
  counter: number;
  last: {
    owner: string;
    view: string;
    snapshot: string;
    refs: Map<string, number>;
  } | null;
};
type TabEntry = {
  owner: TabOwner;
  workspace: HostWorkspace;
  kind: "agent" | "browser" | "preview" | "artifact" | "phone";
  // 연 대상이다. 탭 목록의 kind·title·path를 낸다. browser는 연 url이다.
  target: HostTabTarget | { phone: { app: Id<"app"> } };
  // preview·phone 탭은 앱마다, artifact 탭은 artifact마다 하나라 이 key로 찾는다. 다른 탭은 null이다.
  single: string | null;
  state: BrowserTabState | null;
  phone: PhoneTab | null;
  // 사람이 넘겨준 browser 탭이다. 주인 session도 닫지 못한다.
  handed: boolean;
  // 이 탭을 준 session들이다(`tabs/give`, 먼저 준 쪽부터). 끝은 지금 주인에게 준 session이다. 받은 session은 닫지 못하고, 여기 있는
  // session은 되찾을 수 있다. core 메모리에만 있어 창이 다시 알린 탭은 빈 사슬이다.
  givers: Id<"ses">[];
  // browser 탭의 profile이다. null은 기본 profile이다.
  profile: Id<"bpf"> | null;
};
export type BrowserTabView =
  | { view: "browser" | "preview" | "artifact" }
  | { view: "phone"; phone: PhoneTab };

type BrowserCallPayload = Extract<
  HostRequest,
  { kind: "browser_call" }
>["payload"];
type CallResult = Result<HostToolContent[]>;

// 탭 주인 owner가 caller 자신이거나 caller 밑(`team spawn`으로 연 session)이다. owner에서 spawned_by를 SPAWN_DEPTH번까지 거슬러
// caller를 만나면 참이다. 부모·형제는 거짓이다. 사람 token은 사람 token의 탭만 본다.
const SPAWN_DEPTH = 64;
export function withinTeam(
  caller: TabOwner,
  owner: TabOwner,
  parentOf: (session: Id<"ses">) => string | null,
): boolean {
  if (caller === "person" || owner === "person") return caller === owner;
  let up: string | null = owner;
  for (let step = 0; up !== null && step <= SPAWN_DEPTH; step++) {
    if (up === caller) return true;
    up = parentOf(up as Id<"ses">);
  }
  return false;
}

export const NOT_BROWSER_TAB = "not_browser";

// 넘겨받은 탭을 닫으려 할 때 model이 그대로 받는 문장이다.
const HANDED_TAB =
  "The person handed you this tab; you cannot close it. Tell the person when you are done.";
const GIVEN_TAB =
  "Another session gave you this tab; you cannot close it. Tell that session when you are done: it takes the tab back with `lophn tab give <tab> --back`, and the tab goes back to it when your session ends.";
// `tabs/give`의 거절 문장도 model이 그대로 받는다(work.ts).
const NOT_GIVABLE =
  "Only a browser tab can be given. Open the page with `lophn tab open --url` and give that tab.";
const NOT_HOLDER =
  "You do not hold this tab, so you cannot give it. Only the session that holds a tab gives it on; a session that gave it can take it back with `lophn tab give <tab> --back`.";

// 다른 wiring(browser·tab route, 터미널 탭 열기, 멀리서 page 보기)이 쓰는 port다.
export type HostQueue = {
  enqueue(request: HostRequest): void;
  // browser 호출을 넣고 shell main의 결과를 기다린다. BROWSER_CALL_MS 안에 답이 없으면 `expire()`가 거두고 `unavailable`로 끝낸다.
  callBrowser(payload: BrowserCallPayload): {
    id: Id<"hrq">;
    result: Promise<CallResult>;
  };
  // 연결로만 가는 요청(멀리서 page 보기)을 넣고 host의 답을 기다린다. 연결이 없으면 넣지 않고 바로, 연결이 닫히거나
  // 기한(LINK_CALL_MS)이 지나면 `unavailable`이다.
  callLink(request: LinkRequest): Promise<CallResult>;
  abandon(id: Id<"hrq">, message?: string): void;
  // 기한이 지난 호출(browser 호출, browser 탭 열기, 연결 요청)을 거둔다. 부른 쪽이 주기로 부른다.
  expire(): void;
  // 자기가 연 browser·preview·artifact·phone 탭의 종류. 없는 탭, 남의 탭, session·agent 탭은 `not_found`다.
  browserTab(tab: Id<"tab">, caller: TabOwner): Result<BrowserTabView>;
  // 자기 탭(browserTab과 같은 탭)의 browser profile. null은 기본 profile이고, preview·artifact·phone 탭은 profile이 없어
  // NOT_BROWSER_TAB이다(그 탭의 login을 누가 다루는지는 부르는 쪽이 정한다). 없는 탭과 남의 탭은 `not_found`다.
  tabProfile(
    tab: Id<"tab">,
    caller: TabOwner,
  ): Result<Id<"bpf"> | null | typeof NOT_BROWSER_TAB>;

  // 탭 표에 올리고 tab_open 요청을 넣는다. 그 앱의 preview 탭이나 그 artifact의 탭이 이미 있으면 새로 만들지 않고 그 탭의 주인만 바꿔
  // 돌려준다(preview에 기기나 화면이 있으면 같은 탭 id로 tab_open을 다시 넣는다).
  openTab(input: OpenInput): Id<"tab">;
  // phone 탭을 표에만 올린다(shell에 요청을 넣지 않는다). 그 앱의 phone 탭이 이미 있으면 주인과 screen만 바꿔 돌려준다.
  openPhone(input: {
    owner: TabOwner;
    app: Id<"app">;
    screen: string | null;
  }): Id<"tab">;
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
  // 사람이 창의 browser 탭을 session에 넘긴다. tab이 없거나 표에 없으면 그 id(없으면 새 id)로 표에 올리고(tab_open은 넣지 않는다.
  // 탭은 이미 창에 있다), 표에 있는 사람의 browser 탭이면 주인을 바꾼다. 둘 다 `open()`(받을 session이 열려 있다)이 거짓이면
  // `not_found`다. 표에 있는 넘긴 탭은 창이 다시 알린 것이라 주인은 core 표의 것을 그대로 두고(그 사이 주었거나 돌아갔을 수 있다)
  // workspace와 profile만 맞춘다. agent가 연 탭은 `conflict`다.
  hand(input: HandInput, open: () => boolean): Result<Id<"tab">>;
  // caller가 든 browser 탭을 to에게 준다. to가 caller면 되찾기이고 caller가 준 사슬에 있어야 한다. 받는 session의 검사(자기 밑,
  // 열림, 탭을 다룸)는 부른 쪽이 한다. sees가 거짓인 주인의 탭은 없는 탭과 같다. 주인이 바뀌면 창에 tab_owner를 보낸다.
  give(
    tab: Id<"tab">,
    caller: Id<"ses">,
    to: Id<"ses">,
    sees: (owner: TabOwner) => boolean,
  ): Result<Id<"ses">>;
  // session이 끝났다. 그 session이 받은 탭은 준 session이 열려 있으면 그쪽으로, 아니면 사람에게 돌아가고, 사람이 넘긴 탭은 사람에게
  // 돌아간다(넘긴 탭은 표에서 빠진다). 자기가 연 탭은 그대로다.
  ended(session: Id<"ses">, open: (session: Id<"ses">) => boolean): void;
  // inScope가 참인 주인의 탭 목록이다. session 탭의 title은 sessionTitle로 읽는다. title·url은 부른 쪽이 redaction을 거친다.
  list(
    inScope: (owner: TabOwner) => boolean,
    sessionTitle: (session: string) => string,
  ): TabListItem[];
  // `/host-link` 연결이 열려 있다.
  attached(): boolean;
};

type OpenInput = {
  owner: TabOwner;
  workspace: HostWorkspace;
  target: HostTabTarget;
  relation: TabRelation | null;
  source: Id<"ses"> | null;
  // 미리 받은 `newTabId()`다(handoff file 이름에 쓴 탭 id).
  tab?: Id<"tab">;
  // browser 탭의 profile이다. 없으면 기본 profile이다.
  profile?: Id<"bpf">;
  // workflow_origin이 있는 session의 탭은 그 workflow의 desk에 연다.
  desk?: { workflow: string };
  // 같은 부모·step에서 병렬로 생긴 탭이 같은 묶음 key를 가지면 renderer가 한 묶음으로 둔다.
  group?: string;
};

type HandInput = {
  tab?: Id<"tab">;
  owner: Id<"ses">;
  workspace: HostWorkspace;
  profile: Id<"bpf"> | null;
  url: string;
};

const sameWorkspace = (a: HostWorkspace, b: HostWorkspace) =>
  a.kind === b.kind && (a.kind === "home" || a.id === (b as typeof a).id);

const linkOnly = (request: HostRequest) =>
  (LINK_REQUEST_KINDS as readonly string[]).includes(request.kind);

// 결과를 기다리는 요청이다. 빌려 가면 done이 올 때까지 다시 내놓지 않는다(두 번 실행하면 안 된다). browser_call과
// browser 탭의 tab_open(page 만들기를 기다린다), 연결 요청이다.
const isCall = (request: HostRequest) =>
  request.kind === "browser_call" ||
  linkOnly(request) ||
  (request.kind === "tab_open" && "browser" in request.payload.target);

const unavailable = (message: string) =>
  err({ code: "unavailable" as const, message });

// 연결 요청마다 host의 답을 기다리는 기한이다. 입력은 page가 바쁘면 늦게 끝날 수 있어 길다.
export const LINK_CALL_MS: Record<LinkRequestKind, number> = {
  page_stream: 5_000,
  page_read: 5_000,
  page_input: 10_000,
  page_control: 5_000,
};
// 연결 요청의 문장은 멀리서 보는 사람의 화면에 간다.
const LINK_ABSENT = "The browser host on the computer is not connected.";
const LINK_LOST = "The browser host disconnected before it answered.";
const LINK_TIMED_OUT = "The browser host did not answer in time.";

// browser·tab 호출의 이 문장들은 model이 그대로 받는다(work.ts). 원인, 다음 할 일, 되풀이가 통하는지를 적는다.
// browser는 lophn 앱의 창이거나, display 없는 기계에서 lophn이 띄우는 창 없는 browser(page host)다.
export const SHELL_NOT_ATTACHED =
  "lophn's browser is not connected (the lophn app, or the windowless browser lophn starts on a computer without a display), so there is no browser to use. Retrying does not help until a person opens the lophn app or starts lophn again; tell the person.";
const QUEUE_FULL =
  "Too many requests are waiting for the lophn app, so this one was dropped. They wait because the app is not taking them. Retrying may help once the app is running; if it fails again, tell the person.";
const NO_RESULT =
  "The lophn app returned no result for this call. Try once more; if it fails again, tell the person.";
const TIMED_OUT =
  "The browser call timed out before the lophn app answered; the page may be busy or the app stuck. Try once more; if it times out again, tell the person.";
const OPEN_TIMED_OUT =
  "The browser page did not start loading in time (the site may be slow or not answering), so the tab was not opened. Try `lophn tab open` once more; if it fails again, tell the person.";
export const SHELL_START_FAILED =
  "lophn's browser (the lophn app, or the windowless browser on a computer without a display) could not be started, so there is no browser to use. Retrying may help once; if it fails again, tell the person.";
// 이미 연 탭에 부른 browser 호출이나 열던 중 shell이 떨어졌을 때다(browser·preview·artifact 탭 모두).
export const SHELL_LOST =
  "lophn's browser (the lophn app, or the windowless browser on a computer without a display) is not connected, so this tab has no page. Open the tab again with the command you used to open it; if that fails, tell the person.";
// 없는 탭, 닫힌 탭, 남의 탭에 같은 문장을 써서 남의 탭이 있는지 새지 않게 한다.
const NO_SUCH_TAB =
  "No such tab, or it was closed. Open the page again with `lophn tab open`, then use the new tab id.";

function listItem(
  tab: Id<"tab">,
  entry: TabEntry,
  sessionTitle: (session: string) => string,
): TabListItem {
  const { target, state } = entry;
  const item = {
    tab,
    owner: entry.owner === "person" ? null : entry.owner,
    title: "",
    url: null,
    path: null,
    loading: null,
    handed: entry.handed,
  };
  if ("session" in target) {
    return { ...item, kind: "session", title: sessionTitle(target.session) };
  }
  if ("terminal" in target) return { ...item, kind: "terminal" };
  if ("preview" in target) {
    return { ...item, kind: "preview", title: target.preview.app };
  }
  if ("phone" in target) {
    return { ...item, kind: "phone", title: target.phone.app };
  }
  if ("artifact" in target) {
    const { name } = target.artifact;
    return {
      ...item,
      kind: "artifact",
      title: name,
      path: `artifacts/${name}`,
    };
  }
  return {
    ...item,
    kind: "browser",
    title: state?.title ?? "",
    url: state?.url ?? target.browser.url,
    loading: state?.loading ?? null,
  };
}

export function createHostQueue(deps: {
  clock: Clock;
  ids: IdSource;
  // browser 탭이 생기거나 빠지거나 그 상태가 바뀌었다(멀리서 보는 목록). 다른 kind는 부르지 않는다.
  changed?(): void;
}) {
  const pending: Entry[] = [];
  const tabs = new Map<Id<"tab">, TabEntry>();
  const forget = (tab: Id<"tab">) => {
    const entry = tabs.get(tab);
    tabs.delete(tab);
    // 아직 창에 가지 않은 주인 고치기는 버린다. 창이 다시 알린 탭이 core 표의 주인과 다른 주인을 그리지 않게 한다.
    dropOwner(tab);
    if (entry?.kind === "browser") deps.changed?.();
  };
  // 그 탭의 아직 창에 가지 않은 주인 고치기를 뺀다. 창은 마지막 것만 알면 된다.
  const dropOwner = (tab: Id<"tab">) => {
    for (let at = pending.length - 1; at >= 0; at--) {
      const { request } = pending[at]!;
      if (request.kind === "tab_owner" && request.payload.tab === tab) {
        pending.splice(at, 1);
      }
    }
  };
  // 결과를 기다리는 browser_call과 browser 탭 열기, 연결 요청. deadline이 null이면 기한이 없다.
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
  // 열린 `/host-link` 연결이다. 한 번에 하나다. lent는 그 연결로 빌려 주고 아직 done이 오지 않은 요청이다.
  let link: {
    workspaces: readonly HostWorkspace[];
    send(request: HostRequest): void;
    lent: Set<Id<"hrq">>;
  } | null = null;
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
    link?.lent.delete(id);
    const at = pending.findIndex((entry) => entry.request.id === id);
    if (at >= 0) {
      const [entry] = pending.splice(at, 1);
      // shell이 열기를 가져간 적이 없으면 page가 없으니 닫으라고 알릴 것도 없다(받는 shell이 없을 때 쌓이지 않게).
      if (entry!.request.kind === "tab_open" && entry!.borrowedAt === null) {
        forget(entry!.request.payload.tab as Id<"tab">);
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

  const attached = () => link !== null;

  // 호출은 workspace를 가리지 않고 연결이 가져간다. browser 탭의 page는 그 workspace가 안 보여도 창 단위로 살아서
  // 열기(isCall)와 닫기(close가 anywhere를 준다)도 그렇다.
  function enqueue(request: HostRequest, anywhere = isCall(request)): void {
    pending.push({ request, borrowedAt: null, anywhere });
    pushLink();
    if (pending.length > PENDING_MAX) {
      const [dropped] = pending.splice(0, 1);
      settle(dropped!.request.id as Id<"hrq">, unavailable(QUEUE_FULL));
    }
  }

  // 연결이 닿는 요청을 모두 밀어 준다. send가 연결을 닫을 수 있어 매번 같은 연결인지 본다.
  function pushLink(): void {
    const current = link;
    while (current !== null && link === current) {
      const lent = lend(current.workspaces);
      if (lent === null) return;
      current.lent.add(lent.id as Id<"hrq">);
      current.send(lent);
    }
  }

  // 연결이 닫혔다. 그 연결로 빌려 간 결과 요청은 실행됐는지 모르니 거두고(두 번 실행하면 안 된다), 탭 요청은 다시 대기한다.
  // 연결 요청은 그 연결의 page에 대한 것이라 아직 빌려 가지 않은 것까지 모두 거둔다(늦은 입력이 다음 host의 page에 들어가지 않게).
  // browser 탭의 page는 host가 든다. host가 죽거나 끝나면 닫혔다고 알리는 길이 없으므로 연결이 닫힐 때 표에서 뺀다(멀리서 보는
  // 목록에 없는 page가 남지 않게). preview·artifact 탭은 앱이 다시 뜨면 layout에서 다시 열려 그대로 둔다.
  function unlink(current: NonNullable<typeof link>): void {
    if (link !== current) return;
    link = null;
    for (const id of current.lent) {
      const entry = pending.find((found) => found.request.id === id);
      if (entry === undefined) continue;
      if (isCall(entry.request)) {
        abandon(id, linkOnly(entry.request) ? LINK_LOST : SHELL_LOST);
      } else entry.borrowedAt = null;
    }
    for (const entry of [...pending]) {
      if (linkOnly(entry.request)) {
        abandon(entry.request.id as Id<"hrq">, LINK_LOST);
      }
    }
    for (const [tab, entry] of [...tabs]) {
      if (entry.kind === "browser") forget(tab);
    }
  }

  // 자기 탭(연 탭, 넘겨받은 탭)만 다룬다. 없는 탭과 남의 탭은 다르게 답한다(close·show: forbidden, read: 같은 not_found 문장).
  // sees를 주면(close, show) 볼 수 없는 주인의 탭은 없는 탭과 같은 답이다(남의 탭이 있는지 새지 않게).
  function owned(
    tab: Id<"tab">,
    caller: TabOwner,
    missing: "close" | "show" | "read",
    sees?: (owner: TabOwner) => boolean,
  ) {
    const entry = tabs.get(tab);
    if (entry === undefined || (sees !== undefined && !sees(entry.owner))) {
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

  const noSuchTab = () =>
    err({ code: "not_found" as const, message: NO_SUCH_TAB });

  // 창의 탭 값에 지금 주인을 적게 한다. 그 workspace를 보이는 창이 받고, 없으면 보일 때까지 기다린다.
  function announceOwner(tab: Id<"tab">, entry: TabEntry): void {
    dropOwner(tab);
    enqueue({
      id: deps.ids.newId("hrq") as Id<"hrq">,
      kind: "tab_owner",
      workspace: entry.workspace,
      payload: {
        tab,
        ...(entry.owner === "person" ? {} : { owner: entry.owner }),
        given: entry.givers.length > 0,
      },
    });
    deps.changed?.();
  }

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
    const sent: HostTabTarget =
      "browser" in target && input.profile !== undefined
        ? { browser: { ...target.browser, profile: input.profile } }
        : target;
    const open = (tab: Id<"tab">) => {
      const request: HostRequest = {
        id: deps.ids.newId("hrq") as Id<"hrq">,
        kind: "tab_open",
        workspace: input.workspace,
        payload: {
          tab,
          target: sent,
          relation: input.relation,
          source: input.source,
          ...(input.owner === "person" ? {} : { owner: input.owner }),
          ...(input.desk === undefined ? {} : { desk: input.desk }),
          ...(input.group === undefined ? {} : { group: input.group }),
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
          const moved = entry.owner !== input.owner;
          entry.owner = input.owner;
          // 이미 열린 탭의 주인이 바뀌거나 기기나 화면을 주면 같은 탭에 다시 알린다(창이 그 탭의 주인·기기·화면만 바꾼다).
          if (
            moved ||
            ("preview" in input.target &&
              (input.target.preview.device !== null ||
                input.target.preview.screen !== null))
          ) {
            open(id);
          }
          return { tab: id, sent: null };
        }
      }
    }
    const tab = input.tab ?? (deps.ids.newId("tab") as Id<"tab">);
    const kind =
      "preview" in target
        ? "preview"
        : "artifact" in target
          ? "artifact"
          : "browser" in target
            ? "browser"
            : "agent";
    tabs.set(tab, {
      owner: input.owner,
      workspace: input.workspace,
      kind,
      target,
      single,
      state: null,
      phone: null,
      handed: false,
      givers: [],
      profile: input.profile ?? null,
    });
    if (kind === "browser") deps.changed?.();
    return { tab, sent: open(tab) };
  }

  function done(
    id: Id<"hrq">,
    result: "done" | "retry",
    output?: HostToolOutput,
  ): void {
    link?.lent.delete(id);
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
    callBrowser(payload: BrowserCallPayload) {
      const id = deps.ids.newId("hrq") as Id<"hrq">;
      return call(
        { id, kind: "browser_call", payload },
        deps.clock.nowMs() + BROWSER_CALL_MS,
      );
    },
    callLink(request: LinkRequest): Promise<CallResult> {
      if (link === null) return Promise.resolve(unavailable(LINK_ABSENT));
      const id = deps.ids.newId("hrq") as Id<"hrq">;
      return call(
        { id, ...request } as HostRequest,
        deps.clock.nowMs() + LINK_CALL_MS[request.kind],
        () => LINK_TIMED_OUT,
      ).result;
    },
    // `/host-link` 연결 하나가 열렸다. 그 동안 닿는 요청을 send로 바로 밀어 준다. 옛 연결이 있으면 먼저 닫힌 것으로 본다.
    // `visible`이 그리는 workspace를 바꾸고, `pump`는 다시 대기한 요청(retry, 빌린 기한이 지난 탭 요청)을 밀어 준다(부른 쪽이 주기로).
    connect(send: (request: HostRequest) => void) {
      if (link !== null) unlink(link);
      const current: NonNullable<typeof link> = {
        workspaces: [],
        send,
        lent: new Set(),
      };
      link = current;
      launchedAt = null;
      failedAt = null;
      return {
        visible(workspaces: readonly HostWorkspace[]): void {
          current.workspaces = workspaces;
          if (link === current) pushLink();
        },
        pump(): void {
          if (link === current) pushLink();
        },
        close: () => unlink(current),
      };
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
    // 자기가 연 browser·preview·artifact·phone 탭이다. 없는 탭, 남의 탭, session·agent 탭은 `not_found`다.
    browserTab(tab: Id<"tab">, caller: TabOwner): Result<BrowserTabView> {
      const found = owned(tab, caller, "read");
      if (!found.ok) return found;
      const { kind, phone } = found.value;
      if (kind === "agent") return noSuchTab();
      return kind === "phone"
        ? ok({ view: kind, phone: phone! })
        : ok({ view: kind });
    },
    tabProfile(
      tab: Id<"tab">,
      caller: TabOwner,
    ): Result<Id<"bpf"> | null | typeof NOT_BROWSER_TAB> {
      const found = owned(tab, caller, "read");
      if (!found.ok) return found;
      const { kind, profile } = found.value;
      if (kind === "agent") return noSuchTab();
      return ok(kind === "browser" ? profile : NOT_BROWSER_TAB);
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
    newTabId: () => deps.ids.newId("tab") as Id<"tab">,
    hand(input: HandInput, open: () => boolean): Result<Id<"tab">> {
      const found = input.tab === undefined ? undefined : tabs.get(input.tab);
      const closed = () =>
        err({ code: "not_found" as const, message: "session not found" });
      if (found === undefined) {
        if (!open()) return closed();
        const tab = input.tab ?? (deps.ids.newId("tab") as Id<"tab">);
        tabs.set(tab, {
          owner: input.owner,
          workspace: input.workspace,
          kind: "browser",
          target: { browser: { url: input.url } },
          single: null,
          state: { url: input.url, title: "", loading: false },
          phone: null,
          handed: true,
          givers: [],
          profile: input.profile,
        });
        deps.changed?.();
        return ok(tab);
      }
      if (
        found.kind !== "browser" ||
        (!found.handed && found.owner !== "person")
      ) {
        return err({
          code: "conflict" as const,
          message: "Only a browser tab the person opened can be handed over.",
        });
      }
      if (!found.handed) {
        if (!open()) return closed();
        found.owner = input.owner;
        found.givers = [];
        found.handed = true;
      }
      found.workspace = input.workspace;
      found.profile = input.profile;
      deps.changed?.();
      return ok(input.tab!);
    },
    give(
      tab: Id<"tab">,
      caller: Id<"ses">,
      to: Id<"ses">,
      sees: (owner: TabOwner) => boolean,
    ): Result<Id<"ses">> {
      const entry = tabs.get(tab);
      if (entry === undefined || !sees(entry.owner)) return noSuchTab();
      if (entry.kind !== "browser") {
        return err({ code: "invalid_input" as const, message: NOT_GIVABLE });
      }
      if (to === caller) {
        if (entry.owner === caller) return ok(to);
        const at = entry.givers.indexOf(caller);
        if (at < 0) {
          return err({ code: "forbidden" as const, message: NOT_HOLDER });
        }
        entry.givers = entry.givers.slice(0, at);
      } else {
        if (entry.owner !== caller) {
          return err({ code: "forbidden" as const, message: NOT_HOLDER });
        }
        entry.givers = [...entry.givers, caller];
      }
      entry.owner = to;
      announceOwner(tab, entry);
      return ok(to);
    },
    ended(session: Id<"ses">, open: (session: Id<"ses">) => boolean): void {
      for (const [tab, entry] of [...tabs]) {
        if (entry.owner !== session) continue;
        if (entry.givers.length === 0 && !entry.handed) continue;
        // `team end`는 자손을 잎부터 한 tx에서 닫아 event가 commit 뒤에 오므로, 바로 준 session도 이미 끝났을 수 있다. 가장 가까운
        // 열린 session에게 돌아가고 끝난 session은 사슬에서 빠진다.
        const at = entry.givers.findLastIndex(open);
        if (at >= 0) {
          entry.owner = entry.givers[at]!;
          entry.givers = entry.givers.slice(0, at);
        } else if (entry.handed) {
          // 사람의 탭으로 돌아간다. 창이 되찾기처럼 owner·handed_tab을 지운다.
          forget(tab);
          entry.owner = "person";
        } else {
          // agent가 연 탭은 사람 token의 탭으로 만들지 않는다(그 agent의 profile login에 닿는다). 끝난 연 session의 탭으로 돌아가
          // 그 session이 스스로 연 탭과 같이 아무 agent도 다루지 못하고 사람은 창에서 본다. 사슬 처음이 연 session이다.
          entry.owner = entry.givers[0]!;
          entry.givers = [];
        }
        announceOwner(tab, entry);
      }
    },
    list(
      inScope: (owner: TabOwner) => boolean,
      sessionTitle: (session: string) => string,
    ): TabListItem[] {
      return [...tabs]
        .filter(([, entry]) => inScope(entry.owner))
        .map(([tab, entry]) => listItem(tab, entry, sessionTitle));
    },
    // browser 탭 전부다(멀리서 보기의 대상). state는 renderer가 아직 알리지 않았으면 null이다.
    pages(): {
      tab: Id<"tab">;
      owner: TabOwner;
      state: BrowserTabState | null;
    }[] {
      return [...tabs]
        .filter(([, entry]) => entry.kind === "browser")
        .map(([tab, entry]) => ({
          tab,
          owner: entry.owner,
          state: entry.state,
        }));
    },
    openTab: (input: OpenInput) => place(input, false).tab,
    openPhone(input: {
      owner: TabOwner;
      app: Id<"app">;
      screen: string | null;
    }): Id<"tab"> {
      const single = `phone:${input.app}`;
      for (const [id, entry] of tabs) {
        if (entry.single === single) {
          entry.owner = input.owner;
          entry.phone!.screen = input.screen;
          return id;
        }
      }
      const tab = deps.ids.newId("tab") as Id<"tab">;
      tabs.set(tab, {
        owner: input.owner,
        workspace: { kind: "app", id: input.app },
        kind: "phone",
        target: { phone: { app: input.app } },
        single,
        state: null,
        phone: { app: input.app, screen: input.screen, counter: 0, last: null },
        handed: false,
        givers: [],
        profile: null,
      });
      return tab;
    },
    openAndWait(input: OpenInput) {
      const placed = place(input, true);
      return { tab: placed.tab, ...placed.sent! };
    },
    done,
    // renderer가 host 탭의 상태나 닫힘을 알린다. 모르는 탭은 무시한다.
    report(tab: Id<"tab">, state: BrowserTabState | "closed"): void {
      if (state === "closed") forget(tab);
      else {
        const entry = tabs.get(tab);
        if (entry === undefined) return;
        entry.state = state;
        if (entry.kind === "browser") deps.changed?.();
      }
    },
    close(
      tab: Id<"tab">,
      caller: TabOwner,
      sees?: (owner: TabOwner) => boolean,
    ): Result<Id<"tab">> {
      const found = owned(tab, caller, "close", sees);
      if (!found.ok) return found;
      if (found.value.givers.length > 0) {
        return err({ code: "forbidden" as const, message: GIVEN_TAB });
      }
      if (found.value.handed) {
        return err({ code: "forbidden" as const, message: HANDED_TAB });
      }
      forget(tab);
      if (found.value.kind === "phone") return ok(tab);
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
    show(
      tab: Id<"tab">,
      caller: TabOwner,
      sees?: (owner: TabOwner) => boolean,
    ): Result<Id<"tab">> {
      const found = owned(tab, caller, "show", sees);
      if (!found.ok) return found;
      if (found.value.kind === "phone") {
        return err({
          code: "invalid_input" as const,
          message: PHONE_TAB_TEXT.noShow,
        });
      }
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
      return found.value.kind === "browser" && found.value.state !== null
        ? ok(found.value.state)
        : err({ code: "not_found", message: "tab has no browser state" });
    },
  };
}

export type HostQueueService = ReturnType<typeof createHostQueue>;
