// detached 탭의 IPC. 의존은 모두 인자로 받아 Electron 없이 읽고 검토한다.
// 매 요청마다 caller(desktop 창 본문) → 입력 순서로 보고, 창은 sender에서 main이 정한다.
import type { ZodType } from "zod";

import {
  DETACHED_CHANGED_CHANNEL,
  DETACHED_CLOSE_CHANNEL,
  DETACHED_DOCK_CHANNEL,
  DETACHED_FOCUS_CHANNEL,
  DETACHED_OPEN_CHANNEL,
  DETACHED_OPEN_TAB_CHANNEL,
  DETACHED_REMOVE_CHANNEL,
  DETACHED_SHOW_CHANNEL,
  DETACHED_TAKE_CHANNEL,
  type DetachedBounds,
  detachedChangedSchema,
  detachedCloseSchema,
  detachedDockSchema,
  type DetachedEvent,
  detachedFocusSchema,
  detachedOpenSchema,
  type DetachedReply,
  detachedShowSchema,
  detachedTabInputSchema,
  type DetachedTaken,
} from "../../../ipc/detached.ts";
import {
  type CallerContents,
  checkCaller,
  checkInput,
  type ContentsRegistry,
  type IpcEvent,
} from "../ipc-guard.ts";
import type { DetachedRegistry } from "./registry.ts";

interface DetachedIpcDeps {
  registry: ContentsRegistry;
  entries: DetachedRegistry;
  /** sender webContents가 본문인 창. desktop 창이 아니면 undefined다. */
  refOf(sender: CallerContents): { ref: string; detached: boolean } | undefined;
  /** detached 창을 만든다(창은 ctx.detached에도 들어간다). */
  openWindow(start: {
    hash: string;
    bounds?: DetachedBounds;
  }): { ref: string; bounds: DetachedBounds } | undefined;
  /** 창을 닫는다. 부르기 전에 항목을 silent로 표시했다. */
  closeWindow(ref: string): void;
  /** 최소화를 풀고 앞으로 가져온다. */
  focusWindow(ref: string): void;
  /** 창을 숨기거나(hide) focus 없이 보인다. 창 조작은 Electron을 아는 wiring이 한다. */
  setHidden(ref: string, hidden: boolean): void;
  isAlive(ref: string): boolean;
  send(ref: string, event: DetachedEvent): void;
  owns(window: string, views: readonly string[]): boolean;
  moveViews(
    from: string,
    to: string,
    views: readonly string[],
  ): { ok: true } | { ok: false; error: { message: string } };
}

type Handler = (event: IpcEvent, input: unknown) => DetachedReply<unknown>;

const DESKTOP_HOST = "desktop";

function fail(
  code:
    | "invalid_input"
    | "forbidden"
    | "not_found"
    | "conflict"
    | "unavailable",
  message: string,
): { ok: false; error: { code: typeof code; message: string } } {
  return { ok: false, error: { code, message } };
}

export function createDetachedIpc(deps: DetachedIpcDeps) {
  const { entries } = deps;

  type Sender = { ref: string; detached: boolean };
  // caller → 보낸 창의 역할 → 입력 순서. role이 맞지 않으면 forbidden이다.
  function guard<T>(
    event: IpcEvent,
    schema: ZodType<T> | null,
    input: unknown,
    role: "project" | "detached" | "either",
  ): DetachedReply<{ sender: Sender; input: T }> {
    const caller = checkCaller(deps.registry, event);
    if (!caller.ok) return caller;
    const sender =
      caller.value.origin.host === DESKTOP_HOST
        ? deps.refOf(event.sender)
        : undefined;
    if (sender === undefined) {
      return fail("forbidden", "caller is not a desktop window");
    }
    if (role === "project" && sender.detached) {
      return fail("forbidden", "caller is a detached window");
    }
    if (role === "detached" && !sender.detached) {
      return fail("forbidden", "caller is not a detached window");
    }
    if (schema === null) {
      return { ok: true, value: { sender, input: null as T } };
    }
    const checked = checkInput(schema, input);
    if (!checked.ok) return checked;
    return { ok: true, value: { sender, input: checked.value } };
  }

  function closeSilently(ref: string) {
    entries.silence(ref);
    deps.closeWindow(ref);
  }

  const open: Handler = (event, input) => {
    const checked = guard(event, detachedOpenSchema, input, "either");
    if (!checked.ok) return checked;
    const { sender, input: body } = checked.value;
    let parent = sender.ref;
    if (sender.detached) {
      const from = entries.byRef(sender.ref);
      if (from === undefined) return fail("not_found", "no detached window");
      if (from.project !== body.project) {
        return fail("invalid_input", "project does not match the window");
      }
      parent = from.parent;
    }
    const existing = entries.byParentKey(parent, body.tab.key);
    if (existing !== undefined) {
      deps.focusWindow(existing.ref);
      // focusWindow가 창을 보이게 하므로 표도 맞춘다.
      entries.setHidden(existing.ref, false);
      return fail("conflict", "the tab already has a window");
    }
    const views = body.transfer?.views ?? [];
    if (!deps.owns(sender.ref, views)) {
      return fail("invalid_input", "views are not the window's");
    }
    const created = deps.openWindow({
      hash: `#detached=${encodeURIComponent(body.tab.key)}`,
      ...(body.bounds === null ? {} : { bounds: body.bounds }),
    });
    if (created === undefined) return fail("unavailable", "no window");
    // project를 떠나며 조용히 닫은 창의 값은 transfer 없이 다시 여는 이번에만 쓴다. 쓰든 안 쓰든 여기서 지워 PTY를 두 창이 갖지 않게 한다.
    const kept = entries.takeKept(body.project, body.tab.key);
    entries.add({
      ref: created.ref,
      parent,
      project: body.project,
      key: body.tab.key,
      tab: body.tab,
      transfer:
        body.transfer ??
        (kept === null
          ? null
          : {
              value: kept,
              views: [],
            }),
      silent: false,
      hidden: false,
      resume: body.transfer === null ? kept : null,
    });
    const moved = deps.moveViews(sender.ref, created.ref, views);
    if (!moved.ok) {
      // 옮기지 못했으면 layout을 바꾸지 않고 만든 창을 없던 일로 한다.
      closeSilently(created.ref);
      entries.remove(created.ref);
      return fail("unavailable", moved.error.message);
    }
    if (sender.detached) {
      deps.send(parent, {
        kind: "opened",
        tab: body.tab,
        bounds: created.bounds,
      });
    }
    return { ok: true, value: { bounds: created.bounds } };
  };

  const focus: Handler = (event, input) => {
    const checked = guard(event, detachedFocusSchema, input, "project");
    if (!checked.ok) return checked;
    const entry = entries.byParentKey(
      checked.value.sender.ref,
      checked.value.input.key,
    );
    if (entry === undefined) return fail("not_found", "no detached window");
    deps.focusWindow(entry.ref);
    entries.setHidden(entry.ref, false);
    return { ok: true, value: null };
  };

  const showOnly: Handler = (event, input) => {
    const checked = guard(event, detachedShowSchema, input, "project");
    if (!checked.ok) return checked;
    const { sender, input: body } = checked.value;
    const keys = new Set(body.keys);
    for (const entry of entries.childrenOf(sender.ref)) {
      const hidden = !keys.has(entry.key);
      if (hidden === entry.hidden) continue;
      deps.setHidden(entry.ref, hidden);
      entries.setHidden(entry.ref, hidden);
    }
    const missing = body.keys.filter(
      (key) => entries.byParentKey(sender.ref, key) === undefined,
    );
    return { ok: true, value: { missing } };
  };

  const close: Handler = (event, input) => {
    const checked = guard(event, detachedCloseSchema, input, "project");
    if (!checked.ok) return checked;
    const { sender, input: body } = checked.value;
    const targets =
      body.key === null
        ? entries.childrenOf(sender.ref)
        : [entries.byParentKey(sender.ref, body.key)].filter(
            (entry) => entry !== undefined,
          );
    for (const entry of targets) {
      // 전부 닫는 것(null)은 project를 떠나는 길이다. 다시 열 때 이어 붙게 값을 들어 둔다.
      if (body.key === null) entries.keep(entry);
      else entries.takeKept(entry.project, entry.key);
      closeSilently(entry.ref);
    }
    return { ok: true, value: null };
  };

  const take: Handler = (event) => {
    const checked = guard(event, null, null, "detached");
    if (!checked.ok) return checked;
    const entry = entries.byRef(checked.value.sender.ref);
    if (entry === undefined) return fail("not_found", "no detached window");
    const taken: DetachedTaken = {
      project: entry.project,
      tab: entry.tab,
      transfer: entry.transfer,
    };
    return { ok: true, value: taken };
  };

  const dock: Handler = (event, input) => {
    const checked = guard(event, detachedDockSchema, input, "detached");
    if (!checked.ok) return checked;
    const { sender, input: body } = checked.value;
    const entry = entries.byRef(sender.ref);
    if (entry === undefined) return fail("not_found", "no detached window");
    if (body.tab.key !== entry.key) {
      return fail("invalid_input", "tab does not match the window");
    }
    if (!deps.owns(sender.ref, body.transfer.views)) {
      return fail("invalid_input", "views are not the window's");
    }
    if (!deps.isAlive(entry.parent)) {
      return fail("unavailable", "the project window is gone");
    }
    const moved = deps.moveViews(sender.ref, entry.parent, body.transfer.views);
    if (!moved.ok) return fail("unavailable", moved.error.message);
    deps.send(entry.parent, {
      kind: "docked",
      key: entry.key,
      tab: body.tab,
      transfer: body.transfer,
    });
    entries.takeKept(entry.project, entry.key);
    closeSilently(sender.ref);
    return { ok: true, value: null };
  };

  const changed: Handler = (event, input) => {
    const checked = guard(event, detachedChangedSchema, input, "detached");
    if (!checked.ok) return checked;
    const { sender, input: body } = checked.value;
    const entry = entries.byRef(sender.ref);
    if (entry === undefined) return fail("not_found", "no detached window");
    entries.setTab(sender.ref, body.tab);
    if (body.resume !== undefined) entries.setResume(sender.ref, body.resume);
    deps.send(entry.parent, { kind: "changed", key: entry.key, tab: body.tab });
    return { ok: true, value: null };
  };

  const openTab: Handler = (event, input) => {
    const checked = guard(event, detachedTabInputSchema, input, "detached");
    if (!checked.ok) return checked;
    const entry = entries.byRef(checked.value.sender.ref);
    if (entry === undefined) return fail("not_found", "no detached window");
    deps.send(entry.parent, { kind: "open-tab", tab: checked.value.input.tab });
    deps.focusWindow(entry.parent);
    return { ok: true, value: null };
  };

  const remove: Handler = (event) => {
    const checked = guard(event, null, null, "detached");
    if (!checked.ok) return checked;
    const entry = entries.byRef(checked.value.sender.ref);
    if (entry === undefined) return fail("not_found", "no detached window");
    deps.send(entry.parent, { kind: "closed", key: entry.key });
    entries.takeKept(entry.project, entry.key);
    closeSilently(entry.ref);
    return { ok: true, value: null };
  };

  return [
    [DETACHED_OPEN_CHANNEL, open],
    [DETACHED_FOCUS_CHANNEL, focus],
    [DETACHED_CLOSE_CHANNEL, close],
    [DETACHED_SHOW_CHANNEL, showOnly],
    [DETACHED_TAKE_CHANNEL, take],
    [DETACHED_DOCK_CHANNEL, dock],
    [DETACHED_CHANGED_CHANNEL, changed],
    [DETACHED_OPEN_TAB_CHANNEL, openTab],
    [DETACHED_REMOVE_CHANNEL, remove],
  ] as const satisfies ReadonlyArray<readonly [string, Handler]>;
}
