// 창 하나의 키 → command id 표와 keydown listener 하나. 키 판정은 ipc/keybindings.ts의 것을 쓰고
// command를 하는 일은 registry에 넘긴다. 기능의 구현을 모르고 React도 모른다.
//
// context는 keydown target에서 위로 올라가며 만난 `data-key-context` 이름의 stack이다(안쪽부터, 맨 끝은
// `global`). binding은 context 하나를 가질 수 있고, 안쪽 context부터 사용자 > 기여 > 표의 층 순서로 보고
// 마지막에 context 없는 binding을 본다. 두 타 chord의 첫 타가 지금 부를 수 있는 binding의 머리이면
// SEQUENCE_WAIT_MS 동안 기다렸다가 둘째 타를 본다.
import {
  type Chord,
  type KeyInput,
  type KeyPlatform,
  MODIFIER_CODES,
  parseChord,
  type Stroke,
  strokeMatches,
} from "../../ipc/keybindings.ts";
import type { CommandRegistry, Disposable } from "./registry.ts";

export interface KeybindingInput {
  readonly command: string;
  readonly arg?: unknown;
  /** 이 binding이 듣는 key context 이름. 없으면 어디서나(맨 바깥)에서 듣는다. */
  readonly context?: string;
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

/** context 하나가 자기가 가져갈 stroke를 정한다. `owns`가 참인 chord는 그보다 바깥 binding에 가지 않는다. */
export interface ContextDefinition {
  owns(chord: Chord): boolean;
}

export interface KeybindingService {
  /**
   * 키 하나를 command 하나에 묶는다. 같은 키가 여럿이면 나중에 묶은 것부터 보고, 그 command를 지금
   * 부를 수 없으면(없거나 when이 막으면) 다음 것을 본다. 아무도 못 받으면 키를 넘긴다.
   */
  register(binding: KeybindingInput): Disposable;
  /**
   * 표의 기본 바인딩을 통째로 바꾼다. context 안에서 사용자·기여 binding보다 뒤에 본다.
   */
  setDefaults(bindings: readonly KeybindingInput[]): void;
  /**
   * 사람이 바꾼 키의 binding을 통째로 바꾼다. 같은 context에서 기여·표보다 먼저 본다.
   */
  setUser(bindings: readonly KeybindingInput[]): void;
  /**
   * context 하나의 owns 규칙을 알린다. 반환한 Disposable을 풀면 그 이름의 규칙이 사라진다.
   */
  defineContext(name: string, definition: ContextDefinition): Disposable;
  /** 키를 받았으면 true다. 받은 키만 preventDefault·stopPropagation 한다. */
  handle(event: KeyEventLike): boolean;
  /**
   * target의 keydown을 capture로 듣는다. 편집기(CodeMirror)나 터미널(xterm)이 키를 가져가기 전에
   * 받는다. 같은 target을 여러 번 불러도 listener는 하나이고 마지막 dispose에서 뗀다.
   */
  listen(target: KeyTarget): Disposable;
}

/** 두 타 사이를 기다리는 시간. 이 안에 둘째 타가 오면 연속 key다. */
export const SEQUENCE_WAIT_MS = 1500;

interface Bound {
  readonly command: string;
  readonly arg?: unknown;
  readonly context?: string;
  readonly chords: readonly Chord[];
}

interface Match {
  readonly bound: Bound;
  readonly chord: Chord;
}

/** 첫 타를 먹고 둘째 타를 기다리는 상태. */
interface Pending {
  /** 첫 타. timeout이면 이 키의 홑 binding을 찾는다. */
  readonly input: KeyInput;
  /** 지금 부를 수 있는 두 타 binding들. 둘째 타가 이 중 하나와 맞으면 그것을 실행한다. */
  readonly candidates: readonly Match[];
  readonly cancel: () => void;
}

const inputOf = (event: KeyEventLike): KeyInput => ({
  key: event.key,
  code: event.code,
  ctrl: event.ctrlKey,
  meta: event.metaKey,
  alt: event.altKey,
  shift: event.shiftKey,
});

const strokeOf = (input: KeyInput): Stroke => {
  const code = input.code ?? "";
  return {
    text: "",
    code,
    letter: /^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : null,
    ctrl: input.ctrl,
    meta: input.meta,
    alt: input.alt,
    shift: input.shift,
  };
};

const chordOf = (stroke: Stroke): Chord => ({
  text: stroke.text,
  strokes: [stroke],
});

export function createKeybindingService(deps: {
  registry: CommandRegistry;
  platform: KeyPlatform;
  /**
   * keydown target에서 위로 올라가며 만난 context 이름. 안쪽부터이고 마지막은 늘 `global`이다.
   * DOM을 아는 것은 부르는 쪽(window.ts)이고 service는 이름만 본다.
   */
  contexts: (target: unknown) => readonly string[];
  /** 키를 아예 보지 않을 target(Settings에서 새 키를 받는 칸). */
  ignores: (target: unknown) => boolean;
  /** 기다림 timer. 테스트는 손으로 부르는 timer를 준다. */
  setTimer: (run: () => void, ms: number) => () => void;
}): KeybindingService {
  let user: readonly Bound[] = [];
  let defaults: readonly Bound[] = [];
  let registered: readonly Bound[] = [];
  const definitions = new Map<string, ContextDefinition>();
  let pending: Pending | null = null;
  const listening = new Map<KeyTarget, number>();

  const toBound = (binding: KeybindingInput): Bound => ({
    command: binding.command,
    arg: binding.arg,
    context: binding.context,
    chords: binding[deps.platform].map(parseChord),
  });

  /** 한 context(또는 context 없음)의 binding을 층 순서(사용자 > 기여 > 표)와 나중 것부터. */
  function* ordered(context: string | undefined): Iterable<Bound> {
    for (const layer of [user, registered, defaults]) {
      for (let at = layer.length - 1; at >= 0; at -= 1) {
        const bound = layer[at]!;
        if ((bound.context ?? "") === (context ?? "")) yield bound;
      }
    }
  }

  /** 이 stroke를 볼 수 있는 context의 경계. 안쪽 context가 owns하면 그보다 바깥은 보지 않는다. */
  function scopeOf(
    stack: readonly string[],
    stroke: Stroke,
  ): { contexts: readonly string[]; mayUseGlobal: boolean } {
    for (let at = 0; at < stack.length; at += 1) {
      const definition = definitions.get(stack[at]!);
      if (definition?.owns(chordOf(stroke)) ?? false) {
        return { contexts: stack.slice(0, at + 1), mayUseGlobal: false };
      }
    }
    return { contexts: stack, mayUseGlobal: true };
  }

  /** 이 입력에 첫 타가 맞는 binding들. context stack 순서와 층 순서가 우선순위다. */
  function matchesOf(
    scope: { contexts: readonly string[]; mayUseGlobal: boolean },
    input: KeyInput,
  ): readonly Match[] {
    const matches: Match[] = [];
    const visit = (context: string | undefined) => {
      for (const bound of ordered(context)) {
        const found = bound.chords.find((chord) => {
          const head = chord.strokes[0];
          return head !== undefined && strokeMatches(head, input);
        });
        if (found !== undefined) matches.push({ bound, chord: found });
      }
    };
    for (const context of scope.contexts) visit(context);
    if (scope.mayUseGlobal) visit(undefined);
    return matches;
  }

  function cancelPending(): void {
    const current = pending;
    pending = null;
    current?.cancel();
  }

  function startWait(
    input: KeyInput,
    scope: { contexts: readonly string[]; mayUseGlobal: boolean },
    candidates: readonly Match[],
  ): void {
    if (candidates.length === 0) return;
    let current: Pending | null = null;
    const cancel = deps.setTimer(() => {
      if (current === null || pending !== current) return;
      pending = null;
      // timeout이면 첫 타의 홑 binding을 실행한다(지금도 부를 수 있어야 한다).
      const singles = matchesOf(scope, input).filter(
        (match) => match.chord.strokes.length === 1,
      );
      for (const match of singles) {
        if (!deps.registry.canRun(match.bound.command)) continue;
        deps.registry.execute(match.bound.command, match.bound.arg);
        return;
      }
    }, SEQUENCE_WAIT_MS);
    current = { input, candidates, cancel };
    pending = current;
  }

  function handle(event: KeyEventLike): boolean {
    // 한글 입력 중(조합)은 입력기가 받는다.
    if (event.isComposing || deps.ignores(event.target)) return false;
    const input = inputOf(event);
    // modifier만 누른 keydown은 chord가 아니다(Ctrl을 뗐다 다시 누른 것). 기다리는 연속을 끊지도,
    // 키를 삼키지도 않는다.
    if (
      MODIFIER_CODES.test(input.code ?? "") ||
      MODIFIER_CODES.test(input.key)
    ) {
      return false;
    }

    // 기다리는 중이면 둘째 타를 본다.
    if (pending !== null) {
      // 눌러 둔 반복은 연속을 끝내지 않는다(Esc를 누르고 있어도 Esc Esc가 되지 않게).
      if (event.repeat) {
        event.preventDefault();
        event.stopPropagation();
        return true;
      }
      const second = pending.candidates.find((match) => {
        const stroke = match.chord.strokes[1];
        return (
          stroke !== undefined &&
          strokeMatches(stroke, input) &&
          deps.registry.canRun(match.bound.command)
        );
      });
      if (second !== undefined) {
        cancelPending();
        event.preventDefault();
        event.stopPropagation();
        deps.registry.execute(second.bound.command, second.bound.arg);
        return true;
      }
      // 다른 key(또는 지금 부를 수 없게 된 둘째 타)는 머리를 버리고 이 key를 새로 맞춘다.
      cancelPending();
    }

    const scope = scopeOf(deps.contexts(event.target), strokeOf(input));
    const matches = matchesOf(scope, input);
    for (const match of matches) {
      if (!deps.registry.canRun(match.bound.command)) continue;
      event.preventDefault();
      event.stopPropagation();
      if (match.chord.strokes.length === 1) {
        // 눌러 둔 반복은 부르지 않지만 키는 삼킨다(menu의 Close Window가 반복으로 타지 않게).
        if (!event.repeat) {
          deps.registry.execute(match.bound.command, match.bound.arg);
        }
        return true;
      }
      // 두 타의 머리다. 반복은 연속을 시작하지 않는다.
      if (event.repeat) return true;
      startWait(
        input,
        scope,
        matches.filter(
          (one) =>
            one.chord.strokes.length === 2 &&
            deps.registry.canRun(one.bound.command),
        ),
      );
      return true;
    }
    return false;
  }

  const listener = (event: KeyEventLike) => {
    // handler가 던져도 keydown listener 밖으로 내지 않는다(registry가 이미 자기 handler를 잡는다).
    try {
      handle(event);
    } catch {
      /* 입력은 산다 */
    }
  };
  return {
    handle,
    setDefaults(bindings) {
      defaults = bindings.map(toBound);
    },
    setUser(bindings) {
      user = bindings.map(toBound);
    },
    defineContext(name, definition) {
      definitions.set(name, definition);
      let disposed = false;
      return {
        dispose() {
          if (disposed) return;
          disposed = true;
          if (definitions.get(name) === definition) definitions.delete(name);
        },
      };
    },
    register(binding) {
      const item = toBound(binding);
      registered = [...registered, item];
      let disposed = false;
      return {
        dispose() {
          if (disposed) return;
          disposed = true;
          registered = registered.filter((entry) => entry !== item);
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
