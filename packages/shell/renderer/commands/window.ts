// 창 하나의 command registry와 keybinding service를 만들고 작업대 단축키 표를 묶는다. entry가 창마다
// 하나 만들고 Desktop이 document에 건다. React 밖에서도 같은 값을 쓴다.
import {
  bindingId,
  KEYBINDINGS,
  type Binding,
  type KeyOverrides,
  type KeyPlatform,
  parseBindingId,
  shellOwns,
  tableBinding,
} from "../../ipc/keybindings.ts";
import {
  createKeybindingService,
  type KeybindingInput,
  type KeybindingService,
} from "./keybinding-service.ts";
import {
  type CommandRegistry,
  createCommandRegistry,
  type Disposable,
} from "./registry.ts";

/** extension·앱이 낸 command 하나. Settings › Keyboard가 이 metadata로 동적 id의 줄을 만든다. */
export interface ContributedCommand {
  readonly id: string;
  /** Settings에 보이는 이름. manifest·선언에서 온 평문이라 i18n key가 아니다. */
  readonly title: string;
  /** 기본 key. 사람이 바꾸지 않았을 때 이 chord가 듣는다. */
  readonly other: readonly string[];
  readonly mac: readonly string[];
  /** 듣는 key context. 없으면 어디서나 듣는다. */
  readonly context?: string;
  /** 어디서 왔는가(예: `Extension: harness-gui`). Settings 줄의 설명이 된다. */
  readonly source: string;
}

export interface WindowCommands {
  readonly registry: CommandRegistry;
  readonly keybindings: KeybindingService;
  readonly platform: KeyPlatform;
  /** 사람이 바꾼 키(이 기기 platform). 팔레트 hint와 Settings › Keyboard가 읽는다. */
  overrides(): KeyOverrides;
  /** 사람이 바꾼 키를 창의 기본 바인딩에 덮고 main에도 알린다. 듣는 쪽(subscribe)도 부른다. */
  setOverrides(overrides: KeyOverrides): void;
  /** 사람이 바꾼 키나 기여한 command가 바뀌면 listener를 부른다. 키 이름을 그리는 화면이 다시 그리게. */
  subscribe(listener: () => void): () => void;
  /** 지금 기여된 command들. 목록은 바뀔 때마다 새 배열이다. */
  contributions(): readonly ContributedCommand[];
  /**
   * command 하나를 기여한다. 기본 key를 registered layer에 묶고 metadata를 남긴다. 반환한 Disposable을
   * 풀면 둘 다 사라진다(extension을 끄거나 앱을 지운 것).
   */
  contribute(command: ContributedCommand): Disposable;
  /**
   * 마지막으로 focus를 받은 화면의 동작. registry는 id마다 마지막 주인만 부르므로 여러 탭이 있는 화면
   * (터미널·browser)은 자기 command를 여기 걸고 창 하나의 command가 부른다.
   */
  readonly focus: {
    set(command: string, run: () => void): Disposable;
    has(command: string): boolean;
    run(command: string): boolean;
  };
}

/** Settings에서 새 키를 받는 칸. 그 안의 키는 command로 보내지 않는다. */
export const KEY_CAPTURE_ATTRIBUTE = "data-key-capture";

/** focus를 받은 화면이 자기 동작을 거는 command. 창 하나에 하나뿐인 handler가 부른다. */
const FOCUSED_COMMANDS = [
  "terminal.copy",
  "terminal.paste",
  "browser.bookmark",
] as const;

function closest(target: unknown, selector: string): boolean {
  return (
    typeof Element !== "undefined" &&
    target instanceof Element &&
    target.closest(selector) !== null
  );
}

/** keydown target에서 위로 올라가며 만난 `data-key-context` 이름. 안쪽부터이고 마지막은 `global`이다. */
function keyContexts(target: unknown): readonly string[] {
  if (typeof Element === "undefined" || !(target instanceof Element)) {
    return ["global"];
  }
  const names: string[] = [];
  let node: Element | null = target;
  while (node !== null) {
    const name = node.getAttribute("data-key-context");
    if (name !== null && name !== "") names.push(name);
    node = node.parentElement;
  }
  names.push("global");
  return names;
}

function toInput(binding: Binding): KeybindingInput {
  return {
    command: binding.command,
    ...(binding.arg === undefined ? {} : { arg: binding.arg }),
    ...(binding.context === undefined ? {} : { context: binding.context }),
    other: binding.other,
    mac: binding.mac,
  };
}

/** 표에서 사람이 바꾸지 않은 줄. 사람이 바꾼 줄은 user layer가 대신 듣는다. */
function defaultBindings(overrides: KeyOverrides): readonly KeybindingInput[] {
  return KEYBINDINGS.filter(
    (binding) => overrides[bindingId(binding)] === undefined,
  ).map(toInput);
}

/**
 * 사람이 바꾼 키. 표의 줄은 그 줄의 command·arg·context로, 기여한 command는 기여가 아는 context로,
 * `app.panel:*`은 arg로 푼다. 지금 없는 동적 id도 그대로 듣게 둔다(그 command가 없으면 키만 지나간다).
 */
function userBindings(
  platform: KeyPlatform,
  overrides: KeyOverrides,
  contributions: readonly ContributedCommand[],
): readonly KeybindingInput[] {
  const contexts = new Map(
    contributions.map((command) => [command.id, command.context] as const),
  );
  return Object.entries(overrides).flatMap(
    ([id, chords]): KeybindingInput[] => {
      const parsed = parseBindingId(id);
      if (parsed === null) return [];
      const context = tableBinding(id)?.context ?? contexts.get(id);
      return [
        {
          command: parsed.command,
          ...(parsed.arg === undefined ? {} : { arg: parsed.arg }),
          ...(context === undefined ? {} : { context }),
          other: platform === "other" ? chords : [],
          mac: platform === "mac" ? chords : [],
        },
      ];
    },
  );
}

export function createWindowCommands(deps: {
  platform: KeyPlatform;
  log: (message: string, error: unknown) => void;
  /** main이 먼저 받는 키도 바뀐 키를 따르게 알린다. 통로가 없는 창(gallery)에서는 없다. */
  tellMain?: (overrides: KeyOverrides) => void;
}): WindowCommands {
  const registry = createCommandRegistry({ log: deps.log });
  const keybindings = createKeybindingService({
    registry,
    platform: deps.platform,
    contexts: keyContexts,
    ignores: (target) => closest(target, `[${KEY_CAPTURE_ATTRIBUTE}]`),
    // 실제 timer는 window.ts만 안다. service는 시각을 몰라도 된다.
    setTimer: (run, ms) => {
      const handle = setTimeout(run, ms);
      return () => clearTimeout(handle);
    },
  });
  // 터미널의 Linux·Windows Ctrl+글자 하나는 PTY로 간다(VS Code의 commandsToSkipShell과 같은 생각).
  keybindings.defineContext("terminal", {
    owns: (chord) => shellOwns(chord, deps.platform),
  });

  let current: KeyOverrides = {};
  let contributed: readonly {
    readonly command: ContributedCommand;
    readonly binding: Disposable;
  }[] = [];
  let snapshot: readonly ContributedCommand[] = [];
  const listeners = new Set<() => void>();
  const focused = new Map<string, () => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const refresh = () => {
    keybindings.setDefaults(defaultBindings(current));
    keybindings.setUser(userBindings(deps.platform, current, snapshot));
  };

  const focus = {
    set(command: string, run: () => void) {
      focused.set(command, run);
      let disposed = false;
      return {
        dispose() {
          if (disposed) return;
          disposed = true;
          if (focused.get(command) === run) focused.delete(command);
        },
      };
    },
    has: (command: string) => focused.has(command),
    run(command: string) {
      const run = focused.get(command);
      if (run === undefined) return false;
      run();
      return true;
    },
  };
  // 여러 탭이 mount되어도 handler는 창 하나다. 부를 화면이 focus를 받아야 canRun이 참이 된다.
  for (const command of FOCUSED_COMMANDS) {
    registry.register(command, () => void focus.run(command), {
      when: () => focus.has(command),
    });
  }

  refresh();
  return {
    registry,
    keybindings,
    platform: deps.platform,
    focus,
    overrides: () => current,
    contributions: () => snapshot,
    contribute(command) {
      const binding = keybindings.register({
        command: command.id,
        ...(command.context === undefined ? {} : { context: command.context }),
        other: command.other,
        mac: command.mac,
      });
      const entry = { command, binding };
      contributed = [...contributed, entry];
      snapshot = contributed.map((item) => item.command);
      // 사람이 단 키가 이 command의 context로 다시 묶이게 한다(기여가 늦게 와도).
      refresh();
      notify();
      let disposed = false;
      return {
        dispose() {
          if (disposed) return;
          disposed = true;
          binding.dispose();
          contributed = contributed.filter((item) => item !== entry);
          snapshot = contributed.map((item) => item.command);
          refresh();
          notify();
        },
      };
    },
    setOverrides(overrides) {
      current = overrides;
      refresh();
      deps.tellMain?.(overrides);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
