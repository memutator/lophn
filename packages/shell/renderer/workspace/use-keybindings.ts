// 작업대 단축키의 renderer 쪽. 표와 판정은 ipc/keybindings.ts에 있고 여기는 keydown을 듣고
// 맞는 command를 부르기만 한다. 편집기(CodeMirror)나 터미널(xterm)이 키를 가져가기 전에
// document capture에서 받는다.
import { useEffect, useRef } from "react";

import {
  type Command,
  type KeyPlatform,
  matchKey,
} from "../../ipc/keybindings.ts";

function inTerminal(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("[data-terminal-screen]") !== null
  );
}

/**
 * 표에 있는 키를 받아 `run`을 부른다. 입력칸에서도 받는다. 한글 입력 중(조합)은 건너뛰고,
 * Linux·Windows 터미널의 Ctrl+글자는 shell로 보낸다. 눌러 둔 반복은 run을 부르지 않지만 키는
 * 삼킨다(menu의 Close Window가 반복으로 타지 않게).
 */
export function useKeybindings(
  platform: KeyPlatform,
  run: (command: Command, arg: number | undefined) => void,
): void {
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const hit = matchKey(
        {
          key: event.key,
          code: event.code,
          ctrl: event.ctrlKey,
          meta: event.metaKey,
          alt: event.altKey,
          shift: event.shiftKey,
        },
        platform,
      );
      if (hit === null || (hit.shell && inTerminal(event.target))) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) latest.current(hit.command, hit.arg);
    };
    document.addEventListener("keydown", listener, true);
    return () => document.removeEventListener("keydown", listener, true);
  }, [platform]);
}

const FOCUSABLE = 'textarea, input, [contenteditable="true"], [tabindex="0"]';

/**
 * 키로 칸이나 탭을 옮긴 뒤 그 칸 본문의 입력 자리로 focus를 옮긴다. 이미 본문 안에 focus가
 * 있으면 두고, 입력 자리가 없으면 아무것도 하지 않는다. 화면이 바뀐 다음 프레임에 한다.
 */
export function focusPaneBody(pane: number): void {
  requestAnimationFrame(() => {
    const body = document.querySelector(
      `[data-pane="${pane}"] [data-pane-body]`,
    );
    if (body === null || body.contains(document.activeElement)) return;
    const target = [...body.querySelectorAll<HTMLElement>(FOCUSABLE)].find(
      (element) => element.closest("[hidden]") === null,
    );
    target?.focus();
  });
}
