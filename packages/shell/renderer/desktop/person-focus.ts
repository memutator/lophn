// lophn(agent, 멀리서 보기)이 이 창의 page에 input을 넣는 동안 사람의 keyboard focus를 제자리에 둔다.
// page를 누르면 Chromium이 창의 focus를 그 page로 옮기고, page의 마지막 요소에서 Tab을 치면 focus가 page 밖 다음 요소로 간다.
// 그대로 두면 사람이 치던 글이 agent의 page로 간다. main이 input을 넣는 동안을 알려 주면(driver-input) 그사이 사람이 하지 않은
// focus 이동은 곧바로 되돌리고, 그 이동의 focus event는 창의 다른 곳(칸 focus, float 접기, popover 닫기)에 닿지 않게 삼킨다.

// 사람이 focus를 옮길 수 있는 입력을 한 뒤 이 시간 안의 focus 이동은 사람의 것이다. 단축키가 연 화면은 render 뒤에 focus를 받는다.
const PERSON_MS = 300;

export interface FocusKeeperDeps {
  now(): number;
  /** 지금 focus가 있는 요소. */
  active(): Element | null;
  /** focus를 이 요소로 돌린다(null이면 아무 요소에도 두지 않는다). */
  restore(element: Element | null): void;
  /** focus 이동이 끝난 뒤(같은 event 묶음 밖에서) run을 부른다. */
  later(run: () => void): void;
}

export interface FocusKeeper {
  /** main이 보낸 input 시작(true)·끝(false). */
  mark(on: boolean): void;
  /** 사람이 focus를 옮길 수 있는 입력을 했다. */
  person(): void;
  /** focus event 하나가 왔다. true면 이 event를 삼킨다. */
  focusEvent(): boolean;
}

export function createFocusKeeper(deps: FocusKeeperDeps): FocusKeeper {
  let marks = 0;
  let held: Element | null = null;
  let personAt = Number.NEGATIVE_INFINITY;
  let pending = false;
  const personal = () => deps.now() - personAt < PERSON_MS;
  const check = () => {
    pending = false;
    if (marks === 0) return;
    if (personal()) held = deps.active();
    else if (deps.active() !== held) deps.restore(held);
  };
  return {
    mark(on) {
      if (on) {
        if (marks++ === 0) held = deps.active();
        return;
      }
      if (marks === 0) return;
      if (marks === 1) check();
      marks -= 1;
      if (marks === 0) held = null;
    },
    person() {
      personAt = deps.now();
    },
    focusEvent() {
      if (marks === 0) return false;
      if (!pending) {
        pending = true;
        deps.later(check);
      }
      return !personal();
    },
  };
}

const EDITABLE = "input, textarea, select, [contenteditable]";

// 입력칸에 글자를 치는 것은 focus를 옮기지 않는다. 사람이 쉬지 않고 치는 중에도 agent가 옮긴 focus는 되돌려야 한다.
function movesFocus(event: Event): boolean {
  if (!(event instanceof KeyboardEvent)) return true;
  const typing =
    (event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey) ||
    event.key === "Backspace" ||
    event.key === "Delete";
  const target = event.target instanceof Element ? event.target : null;
  return !(typing && target?.closest(EDITABLE));
}

/** 창 하나에 한 번 건다. 다른 listener보다 먼저 걸어야 삼킨 event가 그들에게 가지 않는다. */
export function keepPersonFocus(
  win: Window,
  subscribe: (listener: (on: boolean) => void) => void,
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
    restore(element) {
      const current = doc.activeElement;
      if (element === null || element === doc.body || !element.isConnected) {
        if (current instanceof HTMLElement) current.blur();
        return;
      }
      // focus가 다른 <webview>에 가 있으면 그 page를 먼저 놓아야 사람의 page가 창의 focus를 다시 받는다(실제 Electron에서 확인).
      if (element.tagName === "WEBVIEW" && current instanceof HTMLElement) {
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
  });
  const person = (event: Event) => {
    if (event.isTrusted && movesFocus(event)) keeper.person();
  };
  const focus = (event: Event) => {
    if (!event.isTrusted || !keeper.focusEvent()) return;
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
  subscribe((on) => keeper.mark(on));
}
