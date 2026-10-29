// 창 하나의 키 → command id 표와 keydown listener 하나. 키 판정은 ipc/keybindings.ts의 것을 쓰고
// command를 하는 일은 registry에 넘긴다. 기능의 구현을 모르고 React도 모른다.
import {
  type Chord,
  chordMatches,
  type KeyPlatform,
  parseChord,
  shellOwns,
} from "../../ipc/keybindings.ts";
import type { CommandRegistry, Disposable } from "./registry.ts";

export interface KeybindingInput {
  readonly command: string;
  readonly arg?: unknown;
  /** Linux·Windows의 chord. */
  readonly other: readonly string[];
  /** macOS의 chord. */
  readonly mac: readonly string[];
}

/** DOM KeyboardEvent에서 쓰는 부분. */
export interface KeyEventLike {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly repeat: boolean;
  readonly isComposing: boolean;
  readonly target: unknown;
  preventDefault(): void;
  stopPropagation(): void;
}

export interface KeyTarget {
  addEventListener(
    type: "keydown",
    listener: (event: KeyEventLike) => void,
    capture: true,
  ): void;
  removeEventListener(
    type: "keydown",
    listener: (event: KeyEventLike) => void,
    capture: true,
  ): void;
}

export interface KeybindingService {
  /**
   * 키 하나를 command 하나에 묶는다. 같은 키가 여럿이면 나중에 묶은 것부터 보고, 그 command를 지금
   * 부를 수 없으면(없거나 when이 막으면) 다음 것을 본다. 아무도 못 받으면 키를 넘긴다.
   */
  register(binding: KeybindingInput): Disposable;
  /**
   * 창의 기본 바인딩(작업대 단축키 표에 사람이 바꾼 키를 덮은 것)을 통째로 바꾼다. register로 묶은
   * 것보다 늘 뒤에 본다. 사람이 키를 바꿔도 기능이 묶은 바인딩의 앞뒤가 바뀌지 않게.
   */
  setDefaults(bindings: readonly KeybindingInput[]): void;
  /** 키를 받았으면 true다. 받은 키만 preventDefault·stopPropagation 한다. */
  handle(event: KeyEventLike): boolean;
  /**
   * target의 keydown을 capture로 듣는다. 편집기(CodeMirror)나 터미널(xterm)이 키를 가져가기 전에
   * 받는다. 같은 target을 여러 번 불러도 listener는 하나이고 마지막 dispose에서 뗀다.
   */
  listen(target: KeyTarget): Disposable;
}

interface Bound {
  readonly command: string;
  readonly arg?: unknown;
  readonly chords: readonly Chord[];
}

export function createKeybindingService(deps: {
  registry: CommandRegistry;
  platform: KeyPlatform;
  /** 터미널(xterm) 안의 target인가. 그 안에서 Linux·Windows의 Ctrl+글자 하나는 shell로 보낸다. */
  inShell: (target: unknown) => boolean;
  /** 키를 아예 보지 않을 target(Settings에서 새 키를 받는 칸). */
  ignores: (target: unknown) => boolean;
}): KeybindingService {
  let bound: readonly Bound[] = [];
  let defaults: readonly Bound[] = [];
  const listening = new Map<KeyTarget, number>();
  const toBound = (binding: KeybindingInput): Bound => ({
    command: binding.command,
    arg: binding.arg,
    chords: binding[deps.platform].map(parseChord),
  });
  const handle = (event: KeyEventLike): boolean => {
    // 한글 입력 중(조합)은 입력기가 받는다.
    if (event.isComposing || deps.ignores(event.target)) return false;
    const input = {
      key: event.key,
      code: event.code,
      ctrl: event.ctrlKey,
      meta: event.metaKey,
      alt: event.altKey,
      shift: event.shiftKey,
    };
    for (const item of [...bound].reverse().concat(defaults)) {
      const chord = item.chords.find((one) => chordMatches(one, input));
      if (chord === undefined) continue;
      if (shellOwns(chord, deps.platform) && deps.inShell(event.target)) {
        return false;
      }
      if (!deps.registry.canRun(item.command)) continue;
      event.preventDefault();
      event.stopPropagation();
      // 눌러 둔 반복은 부르지 않지만 키는 삼킨다(menu의 Close Window가 반복으로 타지 않게).
      if (!event.repeat) deps.registry.execute(item.command, item.arg);
      return true;
    }
    return false;
  };
  const listener = (event: KeyEventLike) => void handle(event);
  return {
    handle,
    setDefaults(bindings) {
      defaults = bindings.map(toBound);
    },
    register(binding) {
      const item = toBound(binding);
      bound = [...bound, item];
      let disposed = false;
      return {
        dispose() {
          if (disposed) return;
          disposed = true;
          bound = bound.filter((entry) => entry !== item);
        },
      };
    },
    listen(target) {
      const count = listening.get(target) ?? 0;
      listening.set(target, count + 1);
      if (count === 0) target.addEventListener("keydown", listener, true);
      let disposed = false;
      return {
        dispose() {
          if (disposed) return;
          disposed = true;
          const left = (listening.get(target) ?? 1) - 1;
          if (left > 0) {
            listening.set(target, left);
            return;
          }
          listening.delete(target);
          target.removeEventListener("keydown", listener, true);
        },
      };
    },
  };
}
