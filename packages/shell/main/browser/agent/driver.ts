// core의 `browser_call` 요청을 실제 탭에 돌리는 port다. surface가 요청을 가져와 여기에 넘기고 결과를 `host/done`에 싣는다.
// 탭의 page에는 `webContents.debugger`(CDP)로 붙는다. 마우스·키는 CDP `Input.*`만 쓴다: webContents의 입력 주입 API는 webview guest에 닿지 않는다.
import type {
  HostRequest,
  HostToolOutput,
} from "../../../../protocol/lophn-agent/host-queue.ts";
import { decideNavigation } from "../navigation.ts";
import type { TabControl } from "./control.ts";
import { parseKey } from "./keys.ts";
import { type Page, type PageLookup, pageOf } from "./page.ts";
import { type AxNode, createRefs, type Refs } from "./snapshot.ts";

export type BrowserCallPayload = Extract<
  HostRequest,
  { kind: "browser_call" }
>["payload"];
export type BrowserDriver = {
  run(payload: BrowserCallPayload): Promise<HostToolOutput>;
};

export interface BrowserDriverDeps {
  /** renderer가 그 탭의 view로 알린 session. 창이 모르면 undefined다. */
  viewSession(tab: string): string | undefined;
  lookup: PageLookup;
  control: TabControl;
  nowMs(): number;
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
const stale = (ref: string, why = "") =>
  fail("conflict", `stale ref ${ref}: run browser snapshot again${why}`);

const LOG_LINES = 200;
const CALL_MS = 20_000;
// 다른 탭 뒤에 숨은 <webview>는 그리지 않아 captureScreenshot이 끝나지 않는다. 오래 매달리지 않는다.
const SHOT_MS = 8_000;
const LOAD_MS = 15_000;
const VALUE_MAX = 20_000;
const DOMAINS = ["Page", "Runtime", "Log", "DOM", "Accessibility"];

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

  function sessionOf(tab: string, page: Page): Session {
    const known = sessions.get(tab);
    if (known?.page.id === page.id) return known;
    if (known !== undefined) {
      // 같은 탭의 view가 바뀌었다. ref 번호는 이어 가고 표만 비운다.
      known.refs.clear();
      if (!known.page.isDestroyed()) known.page.detach();
    }
    const session: Session = {
      page,
      refs: known?.refs ?? createRefs(),
      attached: false,
      attaching: undefined,
      grabbed: false,
      logs: [],
      dialogs: [],
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
        page.detach();
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
      const frame = params.frame as { parentId?: string };
      if (frame.parentId === undefined) session.refs.clear();
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
      throw fail("conflict", "DevTools is open on this tab");
    }
    if (session.attached) return;
    session.attaching ??= (async () => {
      try {
        page.attach();
      } catch {
        throw fail("conflict", "another debugger is attached to this tab");
      }
      try {
        for (const domain of DOMAINS) await page.send(`${domain}.enable`);
        // 숨은 탭도 focus가 있는 것처럼 그리고 screenshot에 답한다.
        await page.send("Emulation.setFocusEmulationEnabled", {
          enabled: true,
        });
      } catch (error) {
        page.detach();
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
        () => reject(fail("unavailable", "the page did not answer")),
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
      throw stale(ref, ` (${(error as Error).message})`);
    }
  }

  async function focus(session: Session, ref: string): Promise<void> {
    const backendNodeId = node(session, ref);
    try {
      await send(session, "DOM.focus", { backendNodeId });
    } catch (error) {
      if (error instanceof CallError) throw error;
      throw stale(ref, ` (${(error as Error).message})`);
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
      throw stale(ref, ` (${(error as Error).message})`);
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

  async function key(session: Session, spec: string): Promise<void> {
    const event = parseKey(spec);
    if (event === undefined) {
      throw fail("invalid_input", `unknown key: ${spec}`);
    }
    await send(session, "Input.dispatchKeyEvent", {
      ...event,
      type: event.text === undefined ? "rawKeyDown" : "keyDown",
    });
    await send(session, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key: event.key,
      code: event.code,
      windowsVirtualKeyCode: event.windowsVirtualKeyCode,
      modifiers: event.modifiers,
    });
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

  // 글자마다 text를 단 key event를 보낸다.
  async function typeText(session: Session, text: string): Promise<void> {
    const events = [...text].flatMap((char) => {
      const enter = char === "\n" || char === "\r";
      const key = enter ? "Enter" : char;
      const typed = enter ? "\r" : char;
      return [
        send(session, "Input.dispatchKeyEvent", {
          type: "keyDown",
          key,
          text: typed,
          unmodifiedText: typed,
        }),
        send(session, "Input.dispatchKeyEvent", { type: "keyUp", key }),
      ];
    });
    await Promise.all(events);
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
      await typeText(session, action.text);
    } else if (action.type === "fill") {
      await focus(session, action.ref);
      await grab(session, action.ref);
      // 전체를 고르고 지운 뒤 넣는다. 빈 글이면 지우기만 한다.
      await callOn(
        session,
        action.ref,
        `function(){ if (this.select) this.select(); else document.execCommand("selectAll"); }`,
      );
      await key(session, "Backspace");
      await typeText(session, action.text);
    } else if (action.type === "press") {
      if (action.ref !== undefined) await focus(session, action.ref);
      await grab(session, action.ref);
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

  async function call(payload: BrowserCallPayload): Promise<HostToolOutput> {
    const { tab, view, action } = payload;
    const viewSession = deps.viewSession(tab);
    const page =
      viewSession === undefined
        ? undefined
        : pageOf(deps.lookup, view, viewSession);
    if (page === undefined || page.isDestroyed()) {
      throw fail("unavailable", "the tab is not open in a window");
    }
    deps.control.touch(tab);
    if (
      deps.control.held(tab) &&
      (action.kind === "act" ||
        action.kind === "navigate" ||
        action.kind === "evaluate")
    ) {
      throw fail("conflict", "the person took control of this tab");
    }
    const session = sessionOf(tab, page);
    await attach(session);

    if (action.kind === "snapshot") {
      const { nodes } = await send<{ nodes: AxNode[] }>(
        session,
        "Accessibility.getFullAXTree",
      );
      return { content: [{ type: "text", text: session.refs.render(nodes) }] };
    }
    if (action.kind === "act") {
      await act(session, action.act);
      await settle(page, deps.nowMs() + LOAD_MS);
      return reply(where(session));
    }
    if (action.kind === "navigate") {
      if (view === "preview") {
        throw fail("invalid_input", "a preview tab can't navigate");
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
        throw fail("unavailable", `navigation failed: ${errorText}`);
      }
      await settle(page, deps.nowMs() + LOAD_MS);
      return reply(where(session));
    }
    if (action.kind === "screenshot") {
      const { data } = await send<{ data: string }>(
        session,
        "Page.captureScreenshot",
        { format: "png" },
        SHOT_MS,
      ).catch((error) => {
        if (!(error instanceof CallError)) throw error;
        throw fail(
          "unavailable",
          "the page was not drawn; a tab hidden behind another tab can't be captured, so show it and try again",
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
          `the condition did not hold within ${action.timeout_ms} ms`,
        );
      }
      await sleep(200);
    }
    return reply(where(session));
  }

  return {
    async run(payload) {
      try {
        return await call(payload);
      } catch (error) {
        if (error instanceof CallError) {
          return { error: { code: error.code, message: error.message } };
        }
        return {
          error: {
            code: "internal",
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
  };
}
