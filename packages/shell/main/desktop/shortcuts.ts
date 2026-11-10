// 창 안 shortcut. OS 전역 단축키로 등록하지 않고 창에 속한 webContents의
// before-input-event만 본다. 그래서 다른 앱에 focus가 있으면 Ctrl+K가 lophn에 오지 않는다.
// 앱 view·overlay·터미널에 focus가 있어도 같은 창의 shell renderer가 받는다.
// 표에서 `main`이 적힌 binding만 보고 그 id 글자를 renderer로 보낸다. 두 타 chord는 main이 세지 않고,
// context가 있는 binding은 그 context를 아는 caller(예: browser page)만 준다.
import {
  type CompiledBindings,
  type KeyHit,
  matchKey,
} from "../../../protocol/shell/keybindings.ts";
import type { WindowShortcut } from "../../ipc/shortcuts.ts";

/** Electron `Input`에서 쓰는 부분. */
interface KeyInput {
  readonly type: string;
  readonly key: string;
  readonly code?: string;
  readonly shift: boolean;
  readonly control: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
  readonly isAutoRepeat?: boolean;
}

/**
 * 키 입력이 표의 `main` binding이면 그 id. CommandOrControl은 platform의 modifier 그대로다.
 * context를 주면 그 context(browser page)의 binding만 본다.
 */
function windowShortcut(
  input: KeyInput,
  platform: string,
  compiled: CompiledBindings | undefined,
  context: string | undefined,
): WindowShortcut | null {
  if (input.type !== "keyDown") return null;
  const hit: KeyHit | null = matchKey(
    {
      key: input.key,
      code: input.code,
      ctrl: input.control,
      meta: input.meta,
      alt: input.alt,
      shift: input.shift,
    },
    platform === "darwin" ? "mac" : "other",
    "main",
    compiled,
    context,
  );
  return hit === null ? null : hit.id;
}

interface InputSource {
  on(
    event: "before-input-event",
    listener: (event: { preventDefault(): void }, input: KeyInput) => void,
  ): void;
}

/**
 * webContents 하나의 키를 본다. `deliver`가 창의 shell renderer를 찾았다고 답할 때만 키를
 * 페이지에 넘기지 않는다. 보호 창처럼 shell 창이 아닌 곳의 키는 그대로 둔다. 눌러 둔 반복은
 * renderer로 보내지 않지만 키는 삼킨다. 반복에서 삼키지 않으면 menu 단축키(Close Window)가 탄다.
 */
export function listenShortcuts(
  source: InputSource,
  platform: string,
  deliver: (shortcut: WindowShortcut, send: boolean) => boolean,
  /** 사람이 바꾼 키를 덮은 표. 없으면 기본 표다. */
  compiled: () => CompiledBindings | undefined = () => undefined,
  /** 이 contents에서 아는 key context(browser page). 모르면 없다. */
  context: () => string | undefined = () => undefined,
): void {
  source.on("before-input-event", (event, input) => {
    const shortcut = windowShortcut(input, platform, compiled(), context());
    if (shortcut !== null && deliver(shortcut, input.isAutoRepeat !== true)) {
      event.preventDefault();
    }
  });
}
