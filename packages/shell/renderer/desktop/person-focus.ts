// lophn(agent, 멀리서 보기)이 이 창의 page에 input을 넣는 동안 사람의 keyboard focus를 제자리에 둔다.
// page를 누르면 Chromium이 창의 focus를 그 page로 옮기고, page의 마지막 요소에서 Tab을 치면 focus가 page 밖 다음 요소로 간다.
// 그대로 두면 사람이 치던 글이 agent의 page로 간다. main이 page마다 input을 넣는 동안을 알려 주면(driver-input) 그사이 focus가
// 그 page의 <webview>로 들어간 것과, 그 page에 Tab을 넣은 뒤의 이동만 곧바로 되돌린다. 다른 이동(timer가 연 dialog, 사람이 누른
// 다른 page)은 그대로 둔다. 되돌리는 이동의 focus event는 창의 다른 곳(칸 focus, float 접기, popover 닫기)에 닿지 않게 삼킨다.
import type { DriverInputMessage } from "../../ipc/shortcuts.ts";

// 사람이 focus를 옮길 수 있는 입력을 한 뒤 이 시간 안의 다음 focus 이동은 사람의 것이다. 단축키가 고른 탭은 render 뒤에 focus를 받는다.
const PERSON_MS = 300;

export interface FocusKeeperDeps {
  now(): number;
  /** 지금 focus가 있는 요소. */
  active(): Element | null;
  /** 이 창 문서가 keyboard focus를 갖고 있다. page(guest)로 간 focus는 activeElement를 바꾸지 않을 때도 있어 이것도 본다. */
  focused(): boolean;
  /** focus를 이 요소로 돌린다(null이면 아무 요소에도 두지 않는다). 이미 그 요소가 activeElement여도 창의 focus를 다시 가져온다. */
  restore(element: Element | null): void;
  /** focus 이동이 끝난 뒤(같은 event 묶음 밖에서) run을 부른다. */
  later(run: () => void): void;
  /** page(webContents id)의 <webview>. 사라졌으면 null이다. */
  webviewOf(page: number): Element | null;
}

export interface FocusKeeper {
  /** main의 알림. start면 사람의 focus가 그 page에 있었는가를 돌려준다(main이 그 page에 온 사람의 키를 버릴지 정한다). */
  message(message: DriverInputMessage): boolean;
  /** 사람이 이 창에서 focus를 옮길 수 있는 입력을 했다. */
  person(): void;
  /**
   * focus event 하나가 왔다. related는 그 event의 relatedTarget이다(page로 들어가는 이동은 그 <webview>이거나 없다). true면 이
   * event를 삼킨다.
   */
  focusEvent(related: Element | null): boolean;
}

export function createFocusKeeper(deps: FocusKeeperDeps): FocusKeeper {
  const marks = new Set<number>();
  let held: Element | null = null;
  // 표시를 켤 때 이 창 문서가 focus를 갖고 있었다. 없었으면(다른 앱, DevTools) 문서가 focus를 잃는 것을 되돌릴 곳이 없다.
  let heldFocused = false;
  let tabbed = false;
  let personAt = Number.NEGATIVE_INFINITY;
  let pending = false;
  const personal = () => deps.now() - personAt < PERSON_MS;
  const later = () => {
    if (pending) return;
    pending = true;
    deps.later(check);
  };
  // page가 사라졌으면(탭을 닫음) end가 오지 않아도 표시를 푼다.
  const prune = () => {
    for (const page of marks)
      if (deps.webviewOf(page) === null) marks.delete(page);
    if (marks.size === 0) {
      held = null;
      tabbed = false;
    }
  };
  const agents = (element: Element | null) =>
    element !== null &&
    [...marks].some((page) => deps.webviewOf(page) === element);
  function check(): void {
    pending = false;
    prune();
    if (marks.size === 0) return;
    const now = deps.active();
    // activeElement는 그대로인데 창 문서가 focus를 잃었다: page로 간 focus가 activeElement를 바꾸지 않은 경우다.
    const away = now === held && heldFocused && !deps.focused();
    if (now === held && !away) return;
    if (personal()) {
      personAt = Number.NEGATIVE_INFINITY;
      held = now;
      heldFocused = deps.focused();
    } else if (tabbed || away || agents(now)) deps.restore(held);
    else {
      held = now;
      heldFocused = deps.focused();
    }
  }
  return {
    message({ page, event }) {
      if (event === "start") {
        prune();
        if (marks.size === 0) {
          held = deps.active();
          heldFocused = deps.focused();
          tabbed = false;
        }
        marks.add(page);
        const webview = deps.webviewOf(page);
        return webview !== null && deps.active() === webview;
      }
      if (event === "person") personAt = deps.now();
      else if (!marks.has(page)) return false;
      else if (event === "tab") {
        tabbed = true;
        later();
      } else {
        check();
        marks.delete(page);
        prune();
      }
      return false;
    },
    person() {
      personAt = deps.now();
    },
    focusEvent(related) {
      if (marks.size === 0) return false;
      later();
      return (related === null || agents(related)) && !personal();
    },
  };
}

const EDITABLE = "input, textarea, select, [contenteditable]";

/**
 * 사람의 입력이 focus를 옮길 수 있는가. 입력칸에 글자를 치는 것은 옮기지 않는다: 사람이 쉬지 않고 치는 중에도 agent가 옮긴
 * focus는 되돌려야 한다. 누르기와 그 밖의 키(Tab, 단축키, Esc, Enter, 화살표)는 옮길 수 있다.
 */
export function movesFocus(input: {
  key?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** 입력칸 안에서 친 키다. */
  editable: boolean;
}): boolean {
  if (input.key === undefined) return true;
  const typing =
    (input.key.length === 1 &&
      !input.ctrlKey &&
      !input.metaKey &&
      !input.altKey) ||
    input.key === "Backspace" ||
    input.key === "Delete";
  return !(typing && input.editable);
}

/** 창 하나에 한 번 건다. 다른 listener보다 먼저 걸어야 삼킨 event가 그들에게 가지 않는다. */
export function keepPersonFocus(
  win: Window,
  driver: {
    subscribe(listener: (message: DriverInputMessage) => void): void;
    answer(page: number, person: boolean): void;
  },
): void {
  const doc = win.document;
  // 사람의 입력칸에서 focus가 빠질 때의 선택. focus만 돌리면 caret이 끝으로 가서, 이어 친 글이 엉뚱한 자리에 들어간다.
  let selection:
    | {
        element: HTMLInputElement | HTMLTextAreaElement;
        start: number;
        end: number;
        direction: "forward" | "backward" | "none";
      }
    | undefined;
  const keeper = createFocusKeeper({
    now: () => win.performance.now(),
    active: () => doc.activeElement,
    focused: () => doc.hasFocus(),
    restore(element) {
      const current = doc.activeElement;
      if (element === null || element === doc.body || !element.isConnected) {
        if (current instanceof HTMLElement) current.blur();
        return;
      }
      // focus가 다른 <webview>에 가 있으면 그 page를 먼저 놓아야 사람의 page가 창의 focus를 다시 받는다. activeElement가 그대로인
      // 채 창의 focus만 page로 갔으면 focus()가 아무것도 하지 않아 한 번 놓는다(실제 Electron에서 확인).
      if (
        current instanceof HTMLElement &&
        (element.tagName === "WEBVIEW" || current === element)
      ) {
        current.blur();
      }
      if (!(element instanceof HTMLElement)) return;
      element.focus({ preventScroll: true });
      if (selection?.element === element) {
        const { start, end, direction } = selection;
        selection.element.setSelectionRange(start, end, direction);
      }
      selection = undefined;
    },
    later: (run) => void win.setTimeout(run, 0),
    webviewOf(page) {
      for (const element of doc.querySelectorAll("webview")) {
        try {
          if ((element as WebviewElement).getWebContentsId() === page) {
            return element;
          }
        } catch {
          // 아직 붙지 않은 <webview>다.
        }
      }
      return null;
    },
  });
  const person = (event: Event) => {
    if (!event.isTrusted) return;
    const target = event.target instanceof Element ? event.target : null;
    const editable = target?.closest(EDITABLE) != null;
    const moves =
      event instanceof KeyboardEvent
        ? movesFocus({
            key: event.key,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            altKey: event.altKey,
            editable,
          })
        : movesFocus({ editable });
    if (moves) keeper.person();
  };
  const focus = (event: Event) => {
    const related =
      event instanceof FocusEvent && event.relatedTarget instanceof Element
        ? event.relatedTarget
        : null;
    if (!event.isTrusted || !keeper.focusEvent(related)) return;
    event.stopImmediatePropagation();
    const { target } = event;
    if (
      event.type === "blur" &&
      (target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement) &&
      target.selectionStart !== null &&
      target.selectionEnd !== null
    ) {
      selection = {
        element: target,
        start: target.selectionStart,
        end: target.selectionEnd,
        direction: target.selectionDirection ?? "none",
      };
    }
  };
  for (const type of ["pointerdown", "mousedown", "keydown"]) {
    win.addEventListener(type, person, true);
  }
  for (const type of ["focus", "blur", "focusin", "focusout"]) {
    win.addEventListener(type, focus, true);
  }
  driver.subscribe((message) => {
    const person = keeper.message(message);
    if (message.event === "start") driver.answer(message.page, person);
  });
}

interface WebviewElement extends Element {
  getWebContentsId(): number;
}
