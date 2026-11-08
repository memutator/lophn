// Settings › Keyboard의 순수 규칙. 표(ipc/keybindings.ts)의 command마다 한 줄이고 줄의 이름과 설명은 wording이다.
// 번호가 있는 command(n번째 탭, split의 n번째 쪽)는 번호마다 바인딩이 따로지만 한 줄로 묶는다. 그 줄은 modifier를
// 바꾸고 번호마다 `<modifier>+Digit<n>`이 된다. 바꾸면 이 기기 OS의 것만 바꾸고 다른 OS의 값은 다시 쓴다.
// extension·앱이 기여한 command(`ext.*`·`app.*`)는 기여의 metadata로 줄을 만들고, 지금 기여가 없는 저장 값은
// "없는 command" 줄로 남겨 지우게 한다.
import { type MessageKey, t } from "@lophn/i18n";

import {
  APP_PANEL,
  appPanelBindingId,
  type Binding,
  type BindingCommand,
  bindingId,
  type Command,
  isDynamicBindingId,
  type KeyConflict,
  type KeyOverrides,
  type KeyPlatform,
  type KeySection,
  parseBindingId,
  parseChord,
  parseStroke,
  resolveBindings,
  sameChord,
  sameStroke,
  tableBinding,
} from "../../../../ipc/keybindings.ts";
import type {
  ContributedCommand,
  KeymapEntry,
} from "../../../commands/window.ts";
import type { StoredKeybindings } from "./source.ts";

interface Wording {
  readonly name: MessageKey;
  readonly help: MessageKey;
}

const WORDING: Readonly<Record<Exclude<Command, "app.panel">, Wording>> = {
  "tab.next": {
    name: "settings.label.key-tab-next",
    help: "settings.note.key-tab-next",
  },
  "tab.prev": {
    name: "settings.label.key-tab-prev",
    help: "settings.note.key-tab-prev",
  },
  "tab.nth": {
    name: "settings.label.key-tab-nth",
    help: "settings.note.key-tab-nth",
  },
  "tab.close": {
    name: "settings.label.key-tab-close",
    help: "settings.note.key-tab-close",
  },
  "tab.reopen": {
    name: "settings.label.key-tab-reopen",
    help: "settings.note.key-tab-reopen",
  },
  "tab.move-left": {
    name: "settings.label.key-tab-move-left",
    help: "settings.note.key-tab-move-left",
  },
  "tab.move-right": {
    name: "settings.label.key-tab-move-right",
    help: "settings.note.key-tab-move-right",
  },
  "pane.focus": {
    name: "settings.label.key-pane-focus",
    help: "settings.note.key-pane-focus",
  },
  "pane.focus-left": {
    name: "settings.label.key-pane-focus-left",
    help: "settings.note.key-pane-focus-direction",
  },
  "pane.focus-right": {
    name: "settings.label.key-pane-focus-right",
    help: "settings.note.key-pane-focus-direction",
  },
  "pane.focus-up": {
    name: "settings.label.key-pane-focus-up",
    help: "settings.note.key-pane-focus-direction",
  },
  "pane.focus-down": {
    name: "settings.label.key-pane-focus-down",
    help: "settings.note.key-pane-focus-direction",
  },
  "pane.split": {
    name: "settings.label.key-pane-split",
    help: "settings.note.key-pane-split",
  },
  "sidebar.toggle": {
    name: "settings.label.key-sidebar-toggle",
    help: "settings.note.key-sidebar-toggle",
  },
  "explorer.focus": {
    name: "settings.label.key-explorer-focus",
    help: "settings.note.key-explorer-focus",
  },
  "search.open": {
    name: "settings.label.key-search-open",
    help: "settings.note.key-search-open",
  },
  "terminal.focus": {
    name: "settings.label.key-terminal-focus",
    help: "settings.note.key-terminal-focus",
  },
  "files.quick-open": {
    name: "settings.label.key-files-quick-open",
    help: "settings.note.key-files-quick-open",
  },
  "tab.rename": {
    name: "settings.label.key-tab-rename",
    help: "settings.note.key-tab-rename",
  },
  "tab.close-others": {
    name: "settings.label.key-tab-close-others",
    help: "settings.note.key-tab-close-others",
  },
  "tab.close-right": {
    name: "settings.label.key-tab-close-right",
    help: "settings.note.key-tab-close-right",
  },
  "tab.close-saved": {
    name: "settings.label.key-tab-close-saved",
    help: "settings.note.key-tab-close-saved",
  },
  "tab.close-all": {
    name: "settings.label.key-tab-close-all",
    help: "settings.note.key-tab-close-all",
  },
  "tab.keep-open": {
    name: "settings.label.key-tab-keep-open",
    help: "settings.note.key-tab-keep-open",
  },
  "tab.copy-path": {
    name: "settings.label.key-tab-copy-path",
    help: "settings.note.key-tab-copy-path",
  },
  "tab.copy-relative-path": {
    name: "settings.label.key-tab-copy-relative-path",
    help: "settings.note.key-tab-copy-relative-path",
  },
  "tab.reveal": {
    name: "settings.label.key-tab-reveal",
    help: "settings.note.key-tab-reveal",
  },
  "pane.split-down": {
    name: "settings.label.key-pane-split-down",
    help: "settings.note.key-pane-split-down",
  },
  "pane.swap-left": {
    name: "settings.label.key-pane-swap-left",
    help: "settings.note.key-pane-swap-left",
  },
  "pane.swap-right": {
    name: "settings.label.key-pane-swap-right",
    help: "settings.note.key-pane-swap-right",
  },
  "pane.swap-up": {
    name: "settings.label.key-pane-swap-up",
    help: "settings.note.key-pane-swap-up",
  },
  "pane.swap-down": {
    name: "settings.label.key-pane-swap-down",
    help: "settings.note.key-pane-swap-down",
  },
  "pane.stack-next": {
    name: "settings.label.key-pane-stack-next",
    help: "settings.note.key-pane-stack-next",
  },
  "pane.stack-prev": {
    name: "settings.label.key-pane-stack-prev",
    help: "settings.note.key-pane-stack-prev",
  },
  "pane.unstack": {
    name: "settings.label.key-pane-unstack",
    help: "settings.note.key-pane-unstack",
  },
  "pane.remove": {
    name: "settings.label.key-pane-remove",
    help: "settings.note.key-pane-remove",
  },
  "pane.unsplit": {
    name: "settings.label.key-pane-unsplit",
    help: "settings.note.key-pane-unsplit",
  },
  "pane.close-others": {
    name: "settings.label.key-pane-close-others",
    help: "settings.note.key-pane-close-others",
  },
  "pane.close-group": {
    name: "settings.label.key-pane-close-group",
    help: "settings.note.key-pane-close-group",
  },
  "desk.new": {
    name: "settings.label.key-desk-new",
    help: "settings.note.key-desk-new",
  },
  "desk.next": {
    name: "settings.label.key-desk-next",
    help: "settings.note.key-desk-next",
  },
  "desk.prev": {
    name: "settings.label.key-desk-prev",
    help: "settings.note.key-desk-prev",
  },
  "desk.nth": {
    name: "settings.label.key-desk-nth",
    help: "settings.note.key-desk-nth",
  },
  "desk.rename": {
    name: "settings.label.key-desk-rename",
    help: "settings.note.key-desk-rename",
  },
  "desk.close": {
    name: "settings.label.key-desk-close",
    help: "settings.note.key-desk-close",
  },
  "tab.float": {
    name: "settings.label.key-tab-float",
    help: "settings.note.key-tab-float",
  },
  "tab.detach": {
    name: "settings.label.key-tab-detach",
    help: "settings.note.key-tab-detach",
  },
  "float.dock": {
    name: "settings.label.key-float-dock",
    help: "settings.note.key-float-dock",
  },
  "float.minimize": {
    name: "settings.label.key-float-minimize",
    help: "settings.note.key-float-minimize",
  },
  "new.terminal": {
    name: "settings.label.key-new-terminal",
    help: "settings.note.key-new-terminal",
  },
  "new.browser": {
    name: "settings.label.key-new-browser",
    help: "settings.note.key-new-browser",
  },
  "new.agent": {
    name: "settings.label.key-new-agent",
    help: "settings.note.key-new-agent",
  },
  "new.document": {
    name: "settings.label.key-new-document",
    help: "settings.note.key-new-document",
  },
  "sidebar.toggle-right": {
    name: "settings.label.key-sidebar-toggle-right",
    help: "settings.note.key-sidebar-toggle-right",
  },
  "nav.back": {
    name: "settings.label.key-nav-back",
    help: "settings.note.key-nav-back",
  },
  "nav.forward": {
    name: "settings.label.key-nav-forward",
    help: "settings.note.key-nav-forward",
  },
  "settings.open": {
    name: "settings.label.key-settings-open",
    help: "settings.note.key-settings-open",
  },
  "palette.open": {
    name: "settings.label.key-palette-open",
    help: "settings.note.key-palette-open",
  },
  "home.open": {
    name: "settings.label.key-home-open",
    help: "settings.note.key-home-open",
  },
  "inbox.open": {
    name: "settings.label.key-inbox-open",
    help: "settings.note.key-inbox-open",
  },
  "jobs.open": {
    name: "settings.label.key-jobs-open",
    help: "settings.note.key-jobs-open",
  },
  "terminal.copy": {
    name: "settings.label.key-terminal-copy",
    help: "settings.note.key-terminal-copy",
  },
  "terminal.paste": {
    name: "settings.label.key-terminal-paste",
    help: "settings.note.key-terminal-paste",
  },
  "browser.bookmark": {
    name: "settings.label.key-browser-bookmark",
    help: "settings.note.key-browser-bookmark",
  },
  "agent.send": {
    name: "settings.label.key-agent-send",
    help: "settings.note.key-agent-send",
  },
  "agent.newline": {
    name: "settings.label.key-agent-newline",
    help: "settings.note.key-agent-newline",
  },
  "agent.interrupt": {
    name: "settings.label.key-agent-interrupt",
    help: "settings.note.key-agent-interrupt",
  },
  "agent.model-picker": {
    name: "settings.label.key-agent-model-picker",
    help: "settings.note.key-agent-model-picker",
  },
  "agent.find": {
    name: "settings.label.key-agent-find",
    help: "settings.note.key-agent-find",
  },
  "agent.jump-previous": {
    name: "settings.label.key-agent-jump-previous",
    help: "settings.note.key-agent-jump",
  },
  "agent.jump-next": {
    name: "settings.label.key-agent-jump-next",
    help: "settings.note.key-agent-jump",
  },
  "agent.scroll-page-up": {
    name: "settings.label.key-agent-scroll-page-up",
    help: "settings.note.key-agent-scroll",
  },
  "agent.scroll-page-down": {
    name: "settings.label.key-agent-scroll-page-down",
    help: "settings.note.key-agent-scroll",
  },
  "agent.scroll-top": {
    name: "settings.label.key-agent-scroll-top",
    help: "settings.note.key-agent-scroll",
  },
  "agent.scroll-bottom": {
    name: "settings.label.key-agent-scroll-bottom",
    help: "settings.note.key-agent-scroll",
  },
  "agent.cycle-mode": {
    name: "settings.label.key-agent-cycle-mode",
    help: "settings.note.key-agent-cycle-mode",
  },
  "agent.send-now": {
    name: "settings.label.key-agent-send-now",
    help: "settings.note.key-agent-send-now",
  },
  "agent.queue": {
    name: "settings.label.key-agent-queue",
    help: "settings.note.key-agent-queue",
  },
  "agent.rewind": {
    name: "settings.label.key-agent-rewind",
    help: "settings.note.key-agent-rewind",
  },
  "agent.history-previous": {
    name: "settings.label.key-agent-history-previous",
    help: "settings.note.key-agent-history",
  },
  "agent.history-next": {
    name: "settings.label.key-agent-history-next",
    help: "settings.note.key-agent-history",
  },
  "agent.history-search": {
    name: "settings.label.key-agent-history-search",
    help: "settings.note.key-agent-history-search",
  },
  "agent.background": {
    name: "settings.label.key-agent-background",
    help: "settings.note.key-agent-background",
  },
  "agent.toggle-details": {
    name: "settings.label.key-agent-toggle-details",
    help: "settings.note.key-agent-toggle-details",
  },
  "agent.clear-input": {
    name: "settings.label.key-agent-clear-input",
    help: "settings.note.key-agent-clear-input",
  },
};

export function commandName(command: Exclude<Command, "app.panel">): string {
  return t(WORDING[command].name);
}

/** Settings 묶음의 순서와 제목. 표가 이미 이 순서로 놓였고 app·contributed는 사람이 단 키가 뒤에 붙는다. */
export const SECTIONS: readonly { section: KeySection; title: MessageKey }[] = [
  { section: "tab", title: "settings.heading.key-section-tab" },
  { section: "pane", title: "settings.heading.key-section-pane" },
  { section: "desk", title: "settings.heading.key-section-desk" },
  { section: "float", title: "settings.heading.key-section-float" },
  { section: "open", title: "settings.heading.key-section-open" },
  { section: "view", title: "settings.heading.key-section-view" },
  { section: "agent", title: "settings.heading.key-section-agent" },
  { section: "terminal", title: "settings.heading.key-section-terminal" },
  { section: "browser", title: "settings.heading.key-section-browser" },
  { section: "app", title: "settings.heading.key-section-app" },
  {
    section: "contributed",
    title: "settings.heading.key-section-contributed",
  },
];

/** 기여한 keymap이 이 command에 건 key 하나. context마다 한 줄이다. */
export interface KeymapLine {
  readonly context: string;
  readonly chords: readonly string[];
}

// harness keymap의 context를 사람이 읽는 이름으로. 모르는 context는 그 글자 그대로 보인다.
const CONTEXT_NAMES: Readonly<Record<string, string>> = {
  "agentView:claude": "Claude Code",
  "agentView:codex": "Codex",
  "agentView:opencode": "OpenCode",
  "agentView:omp": "omp",
};

export function contextName(context: string): string {
  return CONTEXT_NAMES[context] ?? context;
}

/** 한 줄. 번호 줄이면 modifier 하나를 보이고 바꾼다. */
export type KeyRow =
  | {
      readonly kind: "single";
      readonly id: string;
      readonly section: KeySection;
      readonly command: string;
      readonly name: string;
      readonly help: string;
      /** 이 줄이 듣는 key context. 있으면 설명에 보인다. */
      readonly context?: string;
      readonly chords: readonly string[];
      /** 기여한 keymap이 건 key. 사람이 이 command의 key를 바꾸지 않았을 때만 있다(바꾼 key가 대신한다). */
      readonly keymap: readonly KeymapLine[];
      readonly changed: boolean;
      /** 저장된 `app.panel:*`인데 설치된 앱의 panel 화면 목록에 없거나, 기여가 없는 동적 id다. 지우기만 된다. */
      readonly missing: boolean;
    }
  | {
      readonly kind: "numbered";
      readonly section: KeySection;
      readonly command: Command;
      /** 이 줄이 바꾸는 binding id. 번호 순서다. */
      readonly ids: readonly string[];
      readonly name: string;
      readonly help: string;
      /** 번호 앞의 modifier(`Alt`, `Ctrl+Shift`). 번호마다 다르면(사람이 하나만 바꾼 옛 값) null이다. */
      readonly modifier: string | null;
      /** 표에 있는 번호. 0은 마지막 탭이다. */
      readonly numbers: readonly number[];
      readonly changed: boolean;
    };

function contextNote(context: string | undefined): string {
  return context === undefined
    ? ""
    : ` ${t("settings.label.key-context", { context })}`;
}

function modifierOf(chord: string | undefined): string | null {
  if (chord === undefined || !/\+Digit[0-9]$/.test(chord)) return null;
  return chord.slice(0, chord.lastIndexOf("+"));
}

export function keyRows(
  platform: KeyPlatform,
  overrides: KeyOverrides,
  keymap: readonly KeymapEntry[],
): readonly KeyRow[] {
  const bindings = resolveBindings(platform, overrides);
  const rows: KeyRow[] = [];
  for (const binding of bindings) {
    const command = binding.command;
    // 사람이 단 앱 panel 키는 appRows가, 기여한 command는 contributedRows가 줄을 만든다.
    if (command === APP_PANEL) continue;
    if (binding.arg === undefined) {
      rows.push({
        kind: "single",
        id: bindingId(binding),
        section: binding.section,
        command,
        name: commandName(command as Exclude<Command, "app.panel">),
        help: `${t(WORDING[command as Exclude<Command, "app.panel">].help)}${contextNote(binding.context)}`,
        ...(binding.context === undefined ? {} : { context: binding.context }),
        chords: binding[platform],
        keymap:
          overrides[bindingId(binding)] === undefined
            ? keymap
                .filter((entry) => entry.command === command)
                .map((entry) => ({
                  context: entry.context ?? "",
                  chords: entry[platform],
                }))
            : [],
        changed: overrides[bindingId(binding)] !== undefined,
        missing: false,
      });
      continue;
    }
    if (rows.some((row) => row.command === command)) continue;
    const group = bindings.filter((one) => one.command === command);
    const modifiers = new Set(group.map((one) => modifierOf(one[platform][0])));
    rows.push({
      kind: "numbered",
      section: binding.section,
      command: command as Command,
      ids: group.map(bindingId),
      name: commandName(command as Exclude<Command, "app.panel">),
      help: t(WORDING[command as Exclude<Command, "app.panel">].help),
      modifier: modifiers.size === 1 ? [...modifiers][0]! : null,
      numbers: group.map((one) => one.arg as number),
      changed: group.some((one) => overrides[bindingId(one)] !== undefined),
    });
  }
  return rows;
}

/** 기여한 command의 줄과, 기여가 없는데 저장된 동적 id의 "없는 command" 줄. */
export function contributedRows(
  commands: readonly ContributedCommand[],
  platform: KeyPlatform,
  overrides: KeyOverrides,
): readonly KeyRow[] {
  const rows: KeyRow[] = commands.map((command) => ({
    kind: "single" as const,
    id: command.id,
    section: "contributed" as const,
    command: command.id,
    name: command.title,
    help: `${t("settings.note.key-contributed", { source: command.source })}${contextNote(command.context)}`,
    ...(command.context === undefined ? {} : { context: command.context }),
    chords: overrides[command.id] ?? command[platform],
    keymap: [],
    changed: overrides[command.id] !== undefined,
    missing: false,
  }));
  const known = new Set(commands.map((command) => command.id));
  for (const id of Object.keys(overrides)) {
    if (known.has(id) || !isDynamicBindingId(id)) continue;
    rows.push({
      kind: "single",
      id,
      section: "contributed",
      command: id,
      name: t("settings.label.key-missing-command", { id }),
      help: t("settings.note.key-missing-command"),
      chords: overrides[id] ?? [],
      keymap: [],
      changed: true,
      missing: true,
    });
  }
  return rows;
}

/**
 * 겹침·바꾸기 판정에 쓰는 표 밖 binding. 기여한 command는 사람이 바꾼 키(있으면)를, 지금 기여가 없는 저장 값은
 * 그 키를 쓴다.
 */
export function contributedBindings(
  commands: readonly ContributedCommand[],
  platform: KeyPlatform,
  overrides: KeyOverrides,
): readonly Binding[] {
  const bindings: Binding[] = commands.map((command) => {
    const chords = overrides[command.id] ?? command[platform];
    return {
      command: command.id as BindingCommand,
      section: "contributed",
      ...(command.context === undefined ? {} : { context: command.context }),
      other: platform === "other" ? chords : [],
      mac: platform === "mac" ? chords : [],
    };
  });
  const known = new Set(commands.map((command) => command.id));
  for (const id of Object.keys(overrides)) {
    if (known.has(id) || !isDynamicBindingId(id)) continue;
    const chords = overrides[id] ?? [];
    bindings.push({
      command: id as BindingCommand,
      section: "contributed",
      other: platform === "other" ? chords : [],
      mac: platform === "mac" ? chords : [],
    });
  }
  return bindings;
}

/** 기여한 command의 기본 key. `withKeys`가 "표와 같아졌나"를 볼 때 쓴다. */
export function contributedDefaults(
  commands: readonly ContributedCommand[],
  platform: KeyPlatform,
): ReadonlyMap<string, readonly string[]> {
  return new Map(commands.map((command) => [command.id, command[platform]]));
}

/** 검색어가 이름·설명·키 이름에 들어 있는 줄. 대소문자는 보지 않는다. */
export function filterRows(
  rows: readonly KeyRow[],
  query: string,
  label: (row: KeyRow) => string,
): readonly KeyRow[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return rows;
  return rows.filter((row) =>
    [row.name, row.help, label(row)].some((text) =>
      text.toLowerCase().includes(needle),
    ),
  );
}

/**
 * 누른 키 조합을 쓰는 줄. 키로 찾기 토글이 켜졌을 때 쓴다. 두 타 chord는 어느 타든 맞으면 그 줄이다.
 * 번호 줄은 modifier가 같고 누른 키가 그 줄의 숫자면 맞는다(Alt+3이면 탭 번호 줄).
 */
export function rowsWithChord(
  rows: readonly KeyRow[],
  chord: string,
): readonly KeyRow[] {
  const pressed = parseStroke(chord);
  return rows.filter((row) => {
    if (row.kind === "single") {
      return [...row.chords, ...row.keymap.flatMap((line) => line.chords)].some(
        (one) =>
          parseChord(one).strokes.some((stroke) => sameStroke(stroke, pressed)),
      );
    }
    if (row.modifier === null) return false;
    return row.numbers.some((n) =>
      sameStroke(parseStroke(`${row.modifier}+Digit${n}`), pressed),
    );
  });
}

/** 표의 키. 표에 없는 id(앱 panel·기여 command·없는 command)의 기본 키는 주어진 map에서 온다. */
function defaultChords(
  id: string,
  platform: KeyPlatform,
  extra: ReadonlyMap<string, readonly string[]> | undefined,
): readonly string[] {
  return tableBinding(id)?.[platform] ?? extra?.get(id) ?? [];
}

/** binding id들의 키를 한꺼번에 바꾼다. null은 기본 키로 돌린다. 기본 키와 같아지면 저장에서 뺀다. */
export function withKeys(
  stored: StoredKeybindings,
  platform: KeyPlatform,
  changes: Readonly<Record<string, readonly string[] | null>>,
  extraDefaults?: ReadonlyMap<string, readonly string[]>,
): StoredKeybindings {
  const next: Record<string, readonly string[]> = { ...stored[platform] };
  for (const [id, chords] of Object.entries(changes)) {
    const base = defaultChords(id, platform, extraDefaults);
    const same =
      chords !== null &&
      base.length === chords.length &&
      base.every((chord, at) => chord === chords[at]);
    if (chords === null || same) delete next[id];
    else next[id] = chords;
  }
  return { ...stored, [platform]: next };
}

/**
 * "바꾸기". keys(id → 새 chord)를 달고, 같은 context에서 그 chord를 가진 다른 binding에서는 그 chord만 뺀
 * 변경 하나를 만든다. context가 다르면 같은 key라도 겹침이 아니다. 번호 줄의 한 번호가 빼는 쪽이면 그
 * 번호의 chord만 빠진다.
 */
export function takeKeys(
  platform: KeyPlatform,
  overrides: KeyOverrides,
  keys: Readonly<Record<string, readonly string[]>>,
  extra: readonly Binding[] = [],
): Record<string, readonly string[]> {
  const bindings = [...resolveBindings(platform, overrides), ...extra];
  const contextOf = new Map(
    bindings.map((binding) => [bindingId(binding), binding.context ?? ""]),
  );
  const contexts = new Set(
    Object.keys(keys).map((id) => contextOf.get(id) ?? ""),
  );
  const taken = Object.values(keys).flat().map(parseChord);
  const changes: Record<string, readonly string[]> = { ...keys };
  for (const binding of bindings) {
    const id = bindingId(binding);
    if (id in keys) continue;
    if (!contexts.has(binding.context ?? "")) continue;
    const kept = binding[platform].filter(
      (chord) => !taken.some((one) => sameChord(one, parseChord(chord))),
    );
    if (kept.length !== binding[platform].length) changes[id] = kept;
  }
  return changes;
}

/**
 * 앱 section의 줄. choices는 설치된 앱의 panel 화면(`panelChoices`)이고 null이면 아직 모른다(목록을 못 읽었다).
 * 저장된 `app.panel:*` 가운데 choices에 없는 것은 "없는 앱" 줄이다. 키가 없는 화면도 줄이 있어 키를 달 수 있다.
 */
export function appRows(
  choices: readonly { app: string; screen: string; label: string }[] | null,
  overrides: KeyOverrides,
): readonly KeyRow[] {
  const row = (id: string, name: string, missing: boolean): KeyRow => ({
    kind: "single",
    id,
    section: "app",
    command: APP_PANEL,
    name,
    help: t("settings.note.key-app-panel"),
    chords: overrides[id] ?? [],
    keymap: [],
    changed: overrides[id] !== undefined,
    missing,
  });
  const listed = (choices ?? []).map((choice) => ({
    id: appPanelBindingId(choice.app, choice.screen),
    label: choice.label,
  }));
  const known = new Set(listed.map((one) => one.id));
  const saved = Object.keys(overrides).flatMap((id) => {
    const parsed = parseBindingId(id);
    if (parsed?.command !== APP_PANEL || known.has(id)) return [];
    return [
      row(
        id,
        choices === null
          ? String(parsed.arg).replace(":", " · ")
          : t("settings.label.key-missing-app", {
              name: String(parsed.arg).replace(":", " · "),
            }),
        choices !== null,
      ),
    ];
  });
  return [...listed.map((one) => row(one.id, one.label, false)), ...saved];
}

/** 줄이 바꾸는 binding id들. */
function rowIds(row: KeyRow): readonly string[] {
  return row.kind === "single" ? [row.id] : row.ids;
}

/** binding id → 줄 이름. 겹침과 "바꾸기"가 상대 이름을 보일 때 쓴다. */
export function nameOfIds(
  rows: readonly KeyRow[],
): ReadonlyMap<string, string> {
  return new Map(
    rows.flatMap((row) => rowIds(row).map((id) => [id, row.name])),
  );
}

export interface RowConflict {
  /** 같은 키를 쓰는 다른 줄의 이름. */
  readonly names: readonly string[];
  /** lophn이나 OS가 먼저 쓰는 키와 겹친다. */
  readonly reserved: boolean;
}

/** `findConflicts`의 결과를 줄 key(single은 id, 번호 줄은 command) → 겹침으로. 겹치지 않은 줄은 없다. */
export function rowConflicts(
  rows: readonly KeyRow[],
  conflicts: readonly KeyConflict[],
): ReadonlyMap<string, RowConflict> {
  const names = nameOfIds(rows);
  const out = new Map<string, RowConflict>();
  for (const row of rows) {
    const mine = rowIds(row);
    const found: string[] = [];
    let reserved = false;
    for (const conflict of conflicts) {
      if (!conflict.ids.some((id) => mine.includes(id))) continue;
      reserved ||= conflict.reserved;
      for (const id of conflict.ids) {
        const name = names.get(id);
        if (!mine.includes(id) && name !== undefined && !found.includes(name)) {
          found.push(name);
        }
      }
    }
    if (found.length > 0 || reserved) {
      out.set(rowKey(row), { names: found, reserved });
    }
  }
  return out;
}

export function rowKey(row: KeyRow): string {
  return row.kind === "single" ? row.id : row.command;
}

/** 번호 줄에서 겹친 번호의 id만 빈 목록으로. 다른 번호의 키는 둔다. */
export function conflictClearKeys(
  ids: readonly string[],
  conflicts: readonly KeyConflict[],
): Record<string, readonly string[]> {
  const hit = new Set(conflicts.flatMap((one) => one.ids));
  return Object.fromEntries(
    ids.filter((id) => hit.has(id)).map((id) => [id, []]),
  );
}

/** 번호 줄의 새 키. modifier가 null이면 모든 번호의 키를 뺀다. */
export function numberedKeys(
  ids: readonly string[],
  numbers: readonly number[],
  modifier: string | null,
): Record<string, readonly string[]> {
  return Object.fromEntries(
    ids.map((id, at) => [
      id,
      modifier === null ? [] : [`${modifier}+Digit${numbers[at]}`],
    ]),
  );
}

/** 번호 줄에서 누른 키의 modifier. 숫자를 같이 눌렀든 아니든 modifier만 본다(두 타는 받지 않는다). */
export function modifierOfInput(chord: string): string | null {
  const parsed = parseChord(chord);
  if (parsed.strokes.length !== 1) return null;
  const [stroke] = parsed.strokes;
  if (stroke === undefined) return null;
  const parts = [
    ...(stroke.ctrl ? ["Ctrl"] : []),
    ...(stroke.meta ? ["Cmd"] : []),
    ...(stroke.alt ? ["Alt"] : []),
    ...(stroke.shift ? ["Shift"] : []),
  ];
  return parts.length === 0 ? null : parts.join("+");
}

/** 이 기기 OS의 모든 줄을 표의 키로. 다른 OS의 값은 남긴다. */
export function withoutPlatform(
  stored: StoredKeybindings,
  platform: KeyPlatform,
): StoredKeybindings {
  const { [platform]: _drop, ...rest } = stored;
  return rest;
}
