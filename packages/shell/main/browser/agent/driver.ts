// core의 `browser_call` 요청을 실제 탭에 돌리는 port다. surface가 `/host-link`로 받은 요청을 여기에 넘기고 결과를 연결의 `response`에 싣는다.
// 탭의 page에는 `webContents.debugger`(CDP)로 붙는다. 마우스·키는 CDP `Input.*`만 쓴다: webContents의 입력 주입 API는 webview guest에 닿지 않는다.
import { ERROR_CODES } from "../../../../base/mod.ts";
import type {
  BrowserAct,
  HostRequest,
  HostToolOutput,
} from "../../../../protocol/lophn-agent/host-queue.ts";
import { decideNavigation } from "../navigation.ts";
import type { TabControl } from "./control.ts";
import { type CdpSend, pressKey, typeChar, typeText } from "./keys.ts";
import { type Page, type PageLookup, pageOf } from "./page.ts";
import { type AxNode, createRefs, type Refs } from "./snapshot.ts";

export type BrowserCallPayload = Extract<
  HostRequest,
  { kind: "browser_call" }
>["payload"];
export type BrowserDriver = {
  run(payload: BrowserCallPayload): Promise<HostToolOutput>;
  // 사람이 보호 창에 넣은 값을 ref 칸에 한 번 친다(shell main 안에서만 부른다: core의 요청 queue를 지나지 않는다).
  // 칠 때 그 칸이 든 frame의 origin이 card에 보인 origin과 다르면 치지 않고 conflict다.
  typeOnce(input: {
    tab: string;
    view: BrowserCallPayload["view"];
    ref: string;
    origin: string;
    value: string;
  }): Promise<HostToolOutput>;
};

/** shell main이 core `logins/release`를 shell capability로 부른 결과. 값은 이 결과에만 있다. */
export type LoginRelease =
  | { ok: true; value: { value: string } }
  | { ok: false; error: { code: string; message: string } };

/**
 * driver가 지금 key event를 보내는 page 표시(webContents id). wiring이 하나 만들어 driver와 창 단축키 전달(desktop.ts)에 같이 준다.
 * CDP `Input.dispatchKeyEvent`도 guest의 before-input-event를 거쳐, agent가 누른 Control+w가 창의 `tab.close`가 되어 사람의 탭을
 * 닫았다. 표시된 page의 키는 창 단축키로 넘기지도 삼키지도 않아 page에만 간다. Chromium은 key가 before-input-event를 지난 뒤에 그
 * 명령에 답하므로 보내는 동안만 표시하면 된다(실제 Electron에서 확인하지 않았다).
 */
export interface DriverKeys {
  /** page에 key event를 보내는 동안 그 page를 표시한다. */
  sending<T>(page: number, run: () => Promise<T>): Promise<T>;
  /** driver가 지금 이 webContents에 key를 보내는 중이다. 사람이 그 탭에 친 키는 표시되지 않는다. */
  marked(contents: number): boolean;
}

export function createDriverKeys(): DriverKeys {
  // webContents id → 보내는 중인 수.
  const sending = new Map<number, number>();
  return {
    async sending(page, run) {
      sending.set(page, (sending.get(page) ?? 0) + 1);
      try {
        return await run();
      } finally {
        const left = (sending.get(page) ?? 1) - 1;
        if (left === 0) sending.delete(page);
        else sending.set(page, left);
      }
    },
    marked: (contents) => sending.has(contents),
  };
}

export interface BrowserDriverDeps {
  /** frame의 origin(CDP가 잰 값)과 page의 browser profile로 login 값을 받는다. capability는 부르는 쪽이 들고 driver는 모른다. */
  releaseLogin(request: {
    id: string;
    field: "password" | "totp";
    origin: string;
    profile: string | null;
  }): Promise<LoginRelease>;
  /** renderer가 그 탭의 view로 알린 session. 창이 모르면 undefined다. */
  viewSession(tab: string): string | undefined;
  lookup: PageLookup;
  control: TabControl;
  nowMs(): number;
  /** key를 보내는 동안 page를 표시하는 곳. 창 단축키가 없는 곳(창 없는 page host)은 주지 않는다. */
  keys?: DriverKeys;
}

type ErrorCode = Extract<HostToolOutput, { error: unknown }>["error"]["code"];
class CallError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
const fail = (code: ErrorCode, message: string) => new CallError(code, message);
// 이 문장들은 model이 그대로 받는다. lophn이 쓴 고정 문장만 두고 page나 Chromium이 낸 글은 섞지 않는다.
const stale = (ref: string) =>
  fail(
    "conflict",
    `Ref ${ref} is stale because the page changed. Run browser snapshot again and use a ref from the new snapshot; the same ref will not work.`,
  );

// Chromium의 navigation 오류 이름만 싣는다. 그 밖의 글은 page에서 올 수 있어 버린다.
const NET_ERROR = /^net::ERR_[A-Z0-9_]+$/;

const LOG_LINES = 200;
const CALL_MS = 20_000;
// 다른 탭 뒤에 숨은 <webview>는 그리지 않아 captureScreenshot이 끝나지 않는다. 오래 매달리지 않는다.
const SHOT_MS = 8_000;
const LOAD_MS = 15_000;
const VALUE_MAX = 20_000;
const DOMAINS = ["Page", "Runtime", "Log", "DOM", "Accessibility"];
interface FrameNode {
  frame: { id: string; securityOrigin?: string };
  childFrames?: FrameNode[];
}
interface DomNode {
  backendNodeId: number;
  nodeName?: string;
  /** [이름, 값, 이름, 값, ...] */
  attributes?: string[];
  frameId?: string;
  children?: DomNode[];
  shadowRoots?: DomNode[];
  contentDocument?: DomNode;
}

interface Session {
  page: Page;
  refs: Refs;
  attached: boolean;
  attaching: Promise<void> | undefined;
  /** attach한 뒤 마우스를 눌러 guest가 키보드 focus를 얻었다. */
  grabbed: boolean;
  logs: string[];
  /** 아직 결과에 싣지 않은, 자동으로 닫은 dialog. */
  dialogs: { type: string; message: string }[];
  /** fill_login이 값을 치는 frame. 그 frame이나 최상위가 이동하거나 frame이 떨어지면 moved가 선다. */
  typing: { frame: string; moved: boolean } | undefined;
}

type RemoteArg = {
  value?: unknown;
  unserializableValue?: string;
  description?: string;
  type?: string;
};
const showArg = (arg: RemoteArg): string => {
  if (typeof arg.value === "string") return arg.value;
  if (arg.value !== undefined) return JSON.stringify(arg.value);
  return arg.unserializableValue ?? arg.description ?? arg.type ?? "";
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
const reply = (value: unknown): HostToolOutput => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
});

export function createBrowserDriver(deps: BrowserDriverDeps): BrowserDriver {
  const sessions = new Map<string, Session>();
  // 탭이 닫히면 session과 debugger를 놓는다.
  deps.control.onForget((tab) => {
    const session = sessions.get(tab);
    sessions.delete(tab);
    if (session !== undefined && !session.page.isDestroyed()) {
      session.page.detach("driver");
    }
  });

  function sessionOf(tab: string, page: Page): Session {
    const known = sessions.get(tab);
    if (known?.page.id === page.id) return known;
    if (known !== undefined) {
      // 같은 탭의 view가 바뀌었다. ref 번호는 이어 가고 표만 비운다.
      known.refs.clear();
      if (!known.page.isDestroyed()) known.page.detach("driver");
    }
    const session: Session = {
      page,
      refs: known?.refs ?? createRefs(),
      attached: false,
      attaching: undefined,
      grabbed: false,
      logs: [],
      dialogs: [],
      typing: undefined,
    };
    sessions.set(tab, session);
    page.subscribe({
      cdp: (method, params) => onEvent(session, method, params),
      detached() {
        if (session.page === page) session.attached = false;
      },
      devtoolsOpened() {
        if (session.page !== page || !session.attached) return;
        session.attached = false;
        page.detach("driver");
      },
    });
    return session;
  }

  function log(session: Session, line: string): void {
    session.logs.push(line);
    if (session.logs.length > LOG_LINES) session.logs.shift();
  }

  function onEvent(
    session: Session,
    method: string,
    params: Record<string, unknown>,
  ): void {
    if (method === "Page.frameNavigated") {
      const frame = params.frame as { id: string; parentId?: string };
      if (frame.parentId === undefined) session.refs.clear();
      const { typing } = session;
      if (
        typing !== undefined &&
        (frame.parentId === undefined || frame.id === typing.frame)
      ) {
        typing.moved = true;
      }
    } else if (method === "Page.frameDetached") {
      const { typing } = session;
      if (typing?.frame === (params as { frameId: string }).frameId) {
        typing.moved = true;
      }
    } else if (method === "Page.javascriptDialogOpening") {
      const { type, message } = params as { type: string; message: string };
      session.dialogs.push({ type, message });
      // alert·beforeunload는 확인, confirm·prompt는 취소한다. 닫지 않으면 page가 멈춘다.
      void session.page
        .send("Page.handleJavaScriptDialog", {
          accept: type === "alert" || type === "beforeunload",
        })
        .catch(() => {});
    } else if (method === "Runtime.consoleAPICalled") {
      const { type, args } = params as { type: string; args: RemoteArg[] };
      log(session, `[${type}] ${args.map(showArg).join(" ")}`);
    } else if (method === "Runtime.exceptionThrown") {
      const { exceptionDetails: d } = params as {
        exceptionDetails: {
          text: string;
          exception?: { description?: string };
        };
      };
      log(session, `[exception] ${d.exception?.description ?? d.text}`);
    } else if (method === "Log.entryAdded") {
      const { entry } = params as { entry: { level: string; text: string } };
      log(session, `[${entry.level}] ${entry.text}`);
    }
  }

  // DevTools가 열려 있으면 붙지 않는다. 붙은 뒤에 열렸으면 devtoolsOpened가 이미 뗐다.
  async function attach(session: Session): Promise<void> {
    const { page } = session;
    if (page.isDevToolsOpened()) {
      throw fail(
        "conflict",
        "DevTools is open on this tab, so the agent cannot attach. Retrying does not help until the person closes DevTools; tell the person.",
      );
    }
    if (session.attached) return;
    session.attaching ??= (async () => {
      try {
        page.attach("driver");
      } catch {
        throw fail(
          "conflict",
          "Another debugger is attached to this tab. Retrying does not help until the person closes it; tell the person.",
        );
      }
      try {
        for (const domain of DOMAINS) await page.send(`${domain}.enable`);
        // 숨은 탭도 focus가 있는 것처럼 그리고 screenshot에 답한다.
        await page.send("Emulation.setFocusEmulationEnabled", {
          enabled: true,
        });
      } catch (error) {
        page.detach("driver");
        throw error;
      }
      session.attached = true;
      session.grabbed = false;
    })().finally(() => {
      session.attaching = undefined;
    });
    await session.attaching;
  }

  async function send<T = Record<string, never>>(
    session: Session,
    method: string,
    params?: Record<string, unknown>,
    limit = CALL_MS,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            fail(
              "unavailable",
              "The page did not answer in time; it may be busy or stuck. Wait a little and try once more. If it still does not answer, tell the person.",
            ),
          ),
        limit,
      );
    });
    try {
      return await Promise.race([session.page.send<T>(method, params), late]);
    } finally {
      clearTimeout(timer);
    }
  }

  function node(session: Session, ref: string): number {
    const id = session.refs.resolve(ref);
    if (id === undefined) throw stale(ref);
    return id;
  }

  async function center(session: Session, ref: string) {
    const backendNodeId = node(session, ref);
    try {
      await send(session, "DOM.scrollIntoViewIfNeeded", { backendNodeId });
      const { model } = await send<{ model: { content: number[] } }>(
        session,
        "DOM.getBoxModel",
        { backendNodeId },
      );
      const q = model.content;
      return {
        x: ((q[0] ?? 0) + (q[2] ?? 0) + (q[4] ?? 0) + (q[6] ?? 0)) / 4,
        y: ((q[1] ?? 0) + (q[3] ?? 0) + (q[5] ?? 0) + (q[7] ?? 0)) / 4,
      };
    } catch (error) {
      if (error instanceof CallError) throw error;
      throw stale(ref);
    }
  }

  async function focus(session: Session, ref: string): Promise<void> {
    const backendNodeId = node(session, ref);
    try {
      await send(session, "DOM.focus", { backendNodeId });
    } catch (error) {
      if (error instanceof CallError) throw error;
      throw stale(ref);
    }
  }

  // node 하나에 함수를 부른다. 함수가 던지면 invalid_input이다.
  async function callOn(
    session: Session,
    ref: string,
    declaration: string,
    argument?: unknown,
  ): Promise<void> {
    let objectId: string;
    try {
      const resolved = await send<{ object: { objectId: string } }>(
        session,
        "DOM.resolveNode",
        { backendNodeId: node(session, ref) },
      );
      objectId = resolved.object.objectId;
    } catch (error) {
      if (error instanceof CallError) throw error;
      throw stale(ref);
    }
    const called = await send<{
      exceptionDetails?: { exception?: { description?: string }; text: string };
    }>(session, "Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: declaration,
      arguments: argument === undefined ? [] : [{ value: argument }],
      returnByValue: true,
    });
    if (called.exceptionDetails !== undefined) {
      const d = called.exceptionDetails;
      throw fail("invalid_input", d.exception?.description ?? d.text);
    }
  }

  async function mouse(
    session: Session,
    params: Record<string, unknown>,
  ): Promise<void> {
    await send(session, "Input.dispatchMouseEvent", params);
  }

  // 기한을 건 send다(keys.ts의 key·글 치기가 쓴다). key event를 보내는 동안은 그 page를 표시해 창 단축키로 넘어가지 않게 한다.
  const cdp =
    (session: Session): CdpSend =>
    (method, params) =>
      method === "Input.dispatchKeyEvent"
        ? (deps.keys?.sending(session.page.id, () =>
            send(session, method, params),
          ) ?? send(session, method, params))
        : send(session, method, params);

  async function key(session: Session, spec: string): Promise<void> {
    if (!(await pressKey(cdp(session), spec))) {
      throw fail("invalid_input", `unknown key: ${spec}`);
    }
  }

  // guest가 키보드 focus를 갖지 못하면 key event가 버려진다(headless에서 확인: 첫 묶음 뒤 안 들어간다). 마우스를 누르면 focus를
  // 얻으므로 키를 보내기 전에 대상(ref가 없으면 focus가 있는 요소)을 누른다. Input.insertText도 같은 이유로 글이 안 들어간다.
  // ref 없는 press는 앞 동작이 만든 선택(Control+a 뒤 Delete)을 누름이 깨지 않도록 아직 안 눌렀을 때만 누른다.
  async function grab(session: Session, ref?: string): Promise<void> {
    if (ref === undefined && session.grabbed) return;
    let at: { x: number; y: number } | undefined;
    if (ref !== undefined) at = await center(session, ref);
    else {
      const { result } = await send<{ result: { value: number[] | null } }>(
        session,
        "Runtime.evaluate",
        {
          expression: `(() => { const e = document.activeElement; if (!e || e === document.body) return null; const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`,
          returnByValue: true,
        },
      );
      if (result.value)
        at = { x: result.value[0] ?? 0, y: result.value[1] ?? 0 };
    }
    if (at === undefined) return;
    session.grabbed = true;
    const press = { ...at, button: "left", clickCount: 1 };
    await mouse(session, { type: "mousePressed", ...press });
    await mouse(session, { type: "mouseReleased", ...press });
  }

  // 전체를 고르고 지운다. 빈 글이면 지우기만 한다.
  async function clearValue(session: Session, ref: string): Promise<void> {
    await focus(session, ref);
    await grab(session, ref);
    await callOn(
      session,
      ref,
      `function(){ if (this.select) this.select(); else document.execCommand("selectAll"); }`,
    );
    await key(session, "Backspace");
  }

  // value를 찍으면 안 되는 `type=password` 칸의 backend node id들이다. 값이 있는 칸이 없으면 DOM을 읽지 않는다.
  async function passwordNodes(
    session: Session,
    nodes: AxNode[],
  ): Promise<Set<number>> {
    const found = new Set<number>();
    if (
      !nodes.some((n) => n.value?.value !== undefined && n.value.value !== "")
    ) {
      return found;
    }
    const { root } = await send<{ root: DomNode }>(session, "DOM.getDocument", {
      depth: -1,
      pierce: true,
    });
    const stack = [root];
    for (let dom = stack.pop(); dom !== undefined; dom = stack.pop()) {
      const attrs = dom.attributes ?? [];
      const type = attrs.findIndex((a, i) => i % 2 === 0 && a === "type");
      if (
        dom.nodeName === "INPUT" &&
        type >= 0 &&
        attrs[type + 1]?.trim().toLowerCase() === "password"
      ) {
        found.add(dom.backendNodeId);
      }
      stack.push(
        ...(dom.children ?? []),
        ...(dom.shadowRoots ?? []),
        ...(dom.contentDocument === undefined ? [] : [dom.contentDocument]),
      );
    }
    return found;
  }

  // ref 요소가 든 frame의 id다. DOM 전체(iframe 안, shadow 안 포함)에서 그 node를 찾아 가장 가까운 frame owner의 frameId를 읽는다.
  // 페이지 JS가 위조할 수 있는 값(location.origin 등)을 쓰지 않는다. 못 찾으면 undefined다(frame 밖이거나 낡은 ref).
  async function frameOfNode(
    session: Session,
    backendNodeId: number,
    mainFrame: string,
  ): Promise<string | undefined> {
    const { root } = await send<{ root: DomNode }>(session, "DOM.getDocument", {
      depth: -1,
      pierce: true,
    });
    const stack: [DomNode, string][] = [[root, mainFrame]];
    while (stack.length > 0) {
      const [dom, frame] = stack.pop() as [DomNode, string];
      if (dom.backendNodeId === backendNodeId) return frame;
      for (const child of [
        ...(dom.children ?? []),
        ...(dom.shadowRoots ?? []),
      ]) {
        stack.push([child, frame]);
      }
      if (dom.contentDocument !== undefined) {
        stack.push([dom.contentDocument, dom.frameId ?? frame]);
      }
    }
    return undefined;
  }

  // ref 칸이 든 frame의 id다. frameOfNode가 못 찾으면 낡은 ref다.
  async function frameIdOf(session: Session, ref: string): Promise<string> {
    const { frameTree } = await send<{ frameTree: FrameNode }>(
      session,
      "Page.getFrameTree",
    );
    const frameId = await frameOfNode(
      session,
      node(session, ref),
      frameTree.frame.id,
    );
    if (frameId === undefined) throw stale(ref);
    return frameId;
  }

  // frame의 origin이다. CDP가 잰 securityOrigin이고 페이지 JS가 정한 값이 아니다.
  async function originOfFrame(
    session: Session,
    frameId: string,
  ): Promise<string> {
    const { frameTree } = await send<{ frameTree: FrameNode }>(
      session,
      "Page.getFrameTree",
    );
    const stack = [frameTree];
    let origin: string | undefined;
    for (let one = stack.pop(); one !== undefined; one = stack.pop()) {
      if (one.frame.id === frameId) origin = one.frame.securityOrigin;
      stack.push(...(one.childFrames ?? []));
    }
    if (origin === undefined || !URL.canParse(origin)) {
      throw fail("forbidden", "this frame has no origin a login can match");
    }
    return new URL(origin).origin;
  }

  // 값을 ref 칸에 친다. origin은 그 칸이 든 frame의 것을 CDP로 재고(최상위 URL이 아니다), `valueFor`가 그 origin을 보고 값을 낸다
  // (낼 수 없으면 던진다). 치는 동안 그 frame이 이동하면 멈춘다. 값은 이 함수 밖으로 나가지 않는다: 오류 글도 고정 문구다.
  async function typeGuarded(
    session: Session,
    ref: string,
    valueFor: (origin: string) => Promise<string>,
  ): Promise<void> {
    const frameId = await frameIdOf(session, ref);
    // 이동을 보기 시작한 뒤에 origin을 잰다.
    const typing = { frame: frameId, moved: false };
    session.typing = typing;
    try {
      const value = await valueFor(await originOfFrame(session, frameId));
      const stop = () => {
        if (typing.moved) {
          throw fail(
            "conflict",
            "the frame navigated while typing; nothing more was typed",
          );
        }
      };
      try {
        stop();
        await clearValue(session, ref);
        for (const char of value) {
          stop();
          await Promise.all(typeChar(cdp(session), char));
        }
      } catch (error) {
        if (error instanceof CallError) throw error;
        throw fail("unavailable", "typing the value failed");
      }
    } finally {
      session.typing = undefined;
    }
  }

  // login 값은 core가 저장된 origin과 글자 그대로 같고 page의 profile이 login의 profile일 때만 준다.
  async function fillLogin(
    session: Session,
    act: Extract<BrowserAct, { type: "fill_login" }>,
  ): Promise<void> {
    if (act.field === "username") {
      throw fail("invalid_input", "username is filled as text by core");
    }
    const { field } = act;
    await typeGuarded(session, act.ref, async (origin) => {
      const released = await deps.releaseLogin({
        id: act.login,
        field,
        origin,
        profile: session.page.profile,
      });
      if (!released.ok) {
        throw fail(
          (ERROR_CODES as readonly string[]).includes(released.error.code)
            ? (released.error.code as ErrorCode)
            : "internal",
          released.error.message,
        );
      }
      return released.value.value;
    });
  }

  async function act(
    session: Session,
    action: Extract<BrowserCallPayload["action"], { kind: "act" }>["act"],
  ): Promise<void> {
    if (action.type === "click" || action.type === "hover") {
      const { x, y } = await center(session, action.ref);
      await mouse(session, { type: "mouseMoved", x, y });
      if (action.type === "hover") return;
      const press = { x, y, button: "left", clickCount: 1 };
      await mouse(session, { type: "mousePressed", ...press });
      await mouse(session, { type: "mouseReleased", ...press });
    } else if (action.type === "type") {
      await focus(session, action.ref);
      await grab(session, action.ref);
      // 값 끝에 이어 쓴다. 누른 자리가 아니라 끝에 caret을 둔다.
      await callOn(
        session,
        action.ref,
        `function(){
          try { this.setSelectionRange(this.value.length, this.value.length); } catch {
            const range = document.createRange();
            range.selectNodeContents(this);
            range.collapse(false);
            getSelection().removeAllRanges();
            getSelection().addRange(range);
          }
        }`,
      );
      await typeText(cdp(session), action.text);
    } else if (action.type === "fill") {
      await clearValue(session, action.ref);
      await typeText(cdp(session), action.text);
    } else if (action.type === "fill_login") {
      await fillLogin(session, action);
    } else if (action.type === "press") {
      // 누르면 버튼이 눌리므로 ref는 focus만 옮긴다. 키가 들어가려면 앞서 한 번 눌러 focus를 얻은 뒤여야 한다(grab).
      if (action.ref !== undefined) await focus(session, action.ref);
      else await grab(session);
      await key(session, action.key);
    } else if (action.type === "select") {
      await callOn(
        session,
        action.ref,
        `function(values){
          if (this.tagName !== "SELECT") throw new Error("not a select");
          const picked = [...this.options].filter((o) =>
            values.includes(o.value) || values.includes(o.label) || values.includes(o.text.trim()));
          if (picked.length === 0) throw new Error("no option matches");
          if (!this.multiple) picked.length = 1;
          for (const o of this.options) o.selected = picked.includes(o);
          this.dispatchEvent(new Event("input", { bubbles: true }));
          this.dispatchEvent(new Event("change", { bubbles: true }));
        }`,
        action.values,
      );
    } else if (action.ref !== undefined) {
      await center(session, action.ref);
    } else {
      const { result } = await send<{ result: { value: number[] } }>(
        session,
        "Runtime.evaluate",
        { expression: "[innerWidth, innerHeight]", returnByValue: true },
      );
      const [width = 0, height = 0] = result.value;
      await mouse(session, {
        type: "mouseWheel",
        x: width / 2,
        y: height / 2,
        deltaX: 0,
        deltaY: action.dy ?? height,
      });
    }
  }

  // 기기 emulation 중인 page는 emulation한 DPR(deviceScaleFactor) 크기로 찍으면 surface가 그만큼 크지 않아 같은 그림이 타일처럼 반복된다
  // (webview guest에서 확인). CSS px 크기로 보이는 영역만 찍으면 된다. clip은 문서 좌표라 scroll 위치를 더한다.
  async function shotArea(session: Session): Promise<Record<string, unknown>> {
    if (!session.page.emulated()) return {};
    const { result } = await send<{ result: { value: number[] } }>(
      session,
      "Runtime.evaluate",
      {
        expression:
          "[innerWidth, innerHeight, devicePixelRatio, scrollX, scrollY]",
        returnByValue: true,
      },
    );
    const [width = 0, height = 0, dpr = 1, x = 0, y = 0] = result.value;
    return { clip: { x, y, width, height, scale: 1 / dpr } };
  }

  // 누른 뒤 시작한 이동이 끝나기를 잠시 기다린다.
  async function settle(page: Page, until: number): Promise<void> {
    await sleep(150);
    while (page.isLoading() && deps.nowMs() < until) await sleep(100);
  }

  function where(session: Session) {
    const dialog = session.dialogs.at(-1);
    session.dialogs = [];
    return {
      url: session.page.url(),
      title: session.page.title(),
      ...(dialog === undefined ? {} : { dialog }),
    };
  }

  async function holds(
    session: Session,
    wait: Extract<BrowserCallPayload["action"], { kind: "wait" }>,
  ): Promise<boolean> {
    if (wait.url !== undefined) return session.page.url().includes(wait.url);
    try {
      const { result } = await send<{ result: { value?: boolean } }>(
        session,
        "Runtime.evaluate",
        {
          expression: `(document.body?.innerText ?? "").includes(${JSON.stringify(wait.text)})`,
          returnByValue: true,
        },
      );
      return result.value === true;
    } catch {
      // 이동하는 중에는 page를 읽지 못한다. 다시 본다.
      return false;
    }
  }

  // 탭의 page에 붙은 session이다. 쓰는 일은 사람이 탭을 가져가 있으면 conflict다.
  async function sessionFor(
    tab: string,
    view: BrowserCallPayload["view"],
    write: boolean,
  ): Promise<{ session: Session; page: Page }> {
    const viewSession = deps.viewSession(tab);
    const page =
      viewSession === undefined
        ? undefined
        : pageOf(deps.lookup, view, viewSession);
    if (page === undefined || page.isDestroyed()) {
      // browser 탭의 page는 창이 사는 동안 workspace와 상관없이 산다. 여기 오는 때는 page가 방금 사라진 틈(창이 닫힘, page가 죽음)이다.
      throw fail(
        "unavailable",
        view === "browser"
          ? "The browser page is gone: the lophn window or windowless browser that held it was closed, or the page was destroyed. Open the page again with `lophn tab open --url`, then use the new tab id."
          : "The tab is not open in a window: no window is showing this tab's workspace right now. Retrying does not help until a person opens that workspace in lophn; tell the person.",
      );
    }
    deps.control.touch(tab);
    if (write && deps.control.held(tab)) {
      throw fail(
        "conflict",
        "The person took control of this tab, so act, navigate and evaluate are paused; retrying does not help. snapshot, screenshot, logs and wait still work. Tell the person you need the tab handed back.",
      );
    }
    const session = sessionOf(tab, page);
    await attach(session);
    return { session, page };
  }

  async function call(payload: BrowserCallPayload): Promise<HostToolOutput> {
    const { tab, view, action } = payload;
    const { session, page } = await sessionFor(
      tab,
      view,
      action.kind === "act" ||
        action.kind === "navigate" ||
        action.kind === "evaluate",
    );

    if (action.kind === "frame_origin") {
      return reply({
        origin: await originOfFrame(
          session,
          await frameIdOf(session, action.ref),
        ),
        title: page.title(),
      });
    }

    if (action.kind === "snapshot") {
      const { nodes } = await send<{ nodes: AxNode[] }>(
        session,
        "Accessibility.getFullAXTree",
      );
      const hidden = await passwordNodes(session, nodes);
      return {
        content: [{ type: "text", text: session.refs.render(nodes, hidden) }],
      };
    }
    if (action.kind === "act") {
      await act(session, action.act);
      await settle(page, deps.nowMs() + LOAD_MS);
      return reply(where(session));
    }
    if (action.kind === "navigate") {
      if (view !== "browser") {
        throw fail("invalid_input", `a ${view} tab can't navigate`);
      }
      const decision = decideNavigation({ url: action.url, isMainFrame: true });
      if (!decision.allow) {
        throw fail(
          "invalid_input",
          `the url is not allowed: ${decision.reason}`,
        );
      }
      const { errorText } = await send<{ errorText?: string }>(
        session,
        "Page.navigate",
        { url: action.url },
      );
      if (errorText !== undefined) {
        throw fail(
          "unavailable",
          `The navigation failed${NET_ERROR.test(errorText) ? ` (${errorText})` : ""}. Check that the url is right. Retrying the same url helps only if the failure was temporary; if it fails again, tell the person.`,
        );
      }
      await settle(page, deps.nowMs() + LOAD_MS);
      return reply(where(session));
    }
    if (action.kind === "screenshot") {
      const { data } = await send<{ data: string }>(
        session,
        "Page.captureScreenshot",
        { format: "png", ...(await shotArea(session)) },
        SHOT_MS,
      ).catch((error) => {
        if (!(error instanceof CallError)) throw error;
        throw fail(
          "unavailable",
          `The page was not drawn, so no screenshot was taken: a tab hidden behind another tab cannot be captured. Run \`lophn tab show ${tab}\` and try once more. If it fails again, tell the person.`,
        );
      });
      return { content: [{ type: "image", mimeType: "image/png", data }] };
    }
    if (action.kind === "evaluate") {
      const { result, exceptionDetails } = await send<{
        result: { value?: unknown };
        exceptionDetails?: {
          text: string;
          exception?: { description?: string };
        };
      }>(session, "Runtime.evaluate", {
        expression: action.expression,
        returnByValue: true,
        awaitPromise: true,
        timeout: 10_000,
      });
      if (exceptionDetails !== undefined) {
        return reply({
          exception:
            exceptionDetails.exception?.description ?? exceptionDetails.text,
        });
      }
      if (JSON.stringify(result.value ?? null).length > VALUE_MAX) {
        return reply({
          exception: `the value is over ${VALUE_MAX} characters`,
        });
      }
      return reply({ value: result.value });
    }
    if (action.kind === "logs") {
      return { content: [{ type: "text", text: session.logs.join("\n") }] };
    }
    if ((action.text === undefined) === (action.url === undefined)) {
      throw fail("invalid_input", "give exactly one of text or url");
    }
    const until = deps.nowMs() + action.timeout_ms;
    while (!(await holds(session, action))) {
      if (deps.nowMs() >= until) {
        throw fail(
          "unavailable",
          `The condition did not hold within ${action.timeout_ms} ms. Run browser snapshot to see the page, then change the condition or wait longer; the same wait will fail the same way.`,
        );
      }
      await sleep(200);
    }
    return reply(where(session));
  }

  const failed = (error: unknown): HostToolOutput =>
    error instanceof CallError
      ? { error: { code: error.code, message: error.message } }
      : {
          error: {
            code: "internal",
            message: error instanceof Error ? error.message : String(error),
          },
        };

  return {
    async run(payload) {
      try {
        return await call(payload);
      } catch (error) {
        return failed(error);
      }
    },
    async typeOnce({ tab, view, ref, origin, value }) {
      try {
        const { session, page } = await sessionFor(tab, view, true);
        await typeGuarded(session, ref, (now) => {
          if (now !== origin) {
            throw fail(
              "conflict",
              "the page origin changed since the request; nothing was typed",
            );
          }
          return Promise.resolve(value);
        });
        await settle(page, deps.nowMs() + LOAD_MS);
        return reply({});
      } catch (error) {
        return failed(error);
      }
    },
  };
}
