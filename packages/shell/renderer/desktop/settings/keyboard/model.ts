// Settings › Keyboard의 순수 규칙. 표(ipc/keybindings.ts)의 command마다 한 줄이고 줄의 이름과 설명은 wording이다.
// 번호가 있는 command(n번째 탭, n번째 칸)는 번호마다 바인딩이 따로지만 한 줄로 묶는다. 그 줄은 modifier를
// 바꾸고 번호마다 `<modifier>+Digit<n>`이 된다. 바꾸면 이 기기 OS의 것만 바꾸고 다른 OS의 값은 다시 쓴다.
import { type MessageKey, t } from "@lophn/i18n";

import {
  type Binding,
  bindingId,
  type Command,
  KEYBINDINGS,
  type KeyOverrides,
  type KeyPlatform,
  parseChord,
  sameChord,
  resolveBindings,
} from "../../../../ipc/keybindings.ts";
import type { StoredKeybindings } from "./source.ts";

interface Wording {
  readonly name: MessageKey;
  readonly help: MessageKey;
}

const WORDING: Readonly<Record<Command, Wording>> = {
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
  "tab.to-prev-pane": {
    name: "settings.label.key-tab-to-prev-pane",
    help: "settings.note.key-tab-to-prev-pane",
  },
  "tab.to-next-pane": {
    name: "settings.label.key-tab-to-next-pane",
    help: "settings.note.key-tab-to-next-pane",
  },
  "pane.focus": {
    name: "settings.label.key-pane-focus",
    help: "settings.note.key-pane-focus",
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
};

export function commandName(command: Command): string {
  return t(WORDING[command].name);
}

/** 한 줄. 번호 줄이면 modifier 하나를 보이고 바꾼다. */
export type KeyRow =
  | {
      readonly kind: "single";
      readonly id: string;
      readonly command: Command;
      readonly name: string;
      readonly help: string;
      readonly chords: readonly string[];
      readonly changed: boolean;
    }
  | {
      readonly kind: "numbered";
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

function modifierOf(chord: string | undefined): string | null {
  if (chord === undefined || !/\+Digit[0-9]$/.test(chord)) return null;
  return chord.slice(0, chord.lastIndexOf("+"));
}

export function keyRows(
  platform: KeyPlatform,
  overrides: KeyOverrides,
): readonly KeyRow[] {
  const bindings = resolveBindings(platform, overrides);
  const rows: KeyRow[] = [];
  for (const binding of bindings) {
    const command = binding.command;
    if (binding.arg === undefined) {
      rows.push({
        kind: "single",
        id: bindingId(binding),
        command,
        name: commandName(command),
        help: t(WORDING[command].help),
        chords: binding[platform],
        changed: overrides[bindingId(binding)] !== undefined,
      });
      continue;
    }
    if (rows.some((row) => row.command === command)) continue;
    const group = bindings.filter((one) => one.command === command);
    const modifiers = new Set(group.map((one) => modifierOf(one[platform][0])));
    rows.push({
      kind: "numbered",
      command,
      ids: group.map(bindingId),
      name: commandName(command),
      help: t(WORDING[command].help),
      modifier: modifiers.size === 1 ? [...modifiers][0]! : null,
      numbers: group.map((one) => one.arg!),
      changed: group.some((one) => overrides[bindingId(one)] !== undefined),
    });
  }
  return rows;
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
 * 누른 키 조합을 쓰는 줄. 키로 찾기 토글이 켜졌을 때 쓴다. 번호 줄은 modifier가 같고 누른 키가 그 줄의 숫자면
 * 맞는다(Alt+3이면 탭 번호 줄).
 */
export function rowsWithChord(
  rows: readonly KeyRow[],
  chord: string,
): readonly KeyRow[] {
  const pressed = parseChord(chord);
  return rows.filter((row) => {
    if (row.kind === "single") {
      return row.chords.some((one) => sameChord(parseChord(one), pressed));
    }
    if (row.modifier === null) return false;
    return row.numbers.some((n) =>
      sameChord(parseChord(`${row.modifier}+Digit${n}`), pressed),
    );
  });
}

function sameAsTable(
  id: string,
  platform: KeyPlatform,
  chords: readonly string[],
) {
  const base = KEYBINDINGS.find((binding) => bindingId(binding) === id);
  return (
    base !== undefined &&
    base[platform].length === chords.length &&
    base[platform].every((chord, at) => chord === chords[at])
  );
}

/** binding id들의 키를 한꺼번에 바꾼다. null은 표의 키로 돌린다. 표와 같아지면 저장에서 뺀다. */
export function withKeys(
  stored: StoredKeybindings,
  platform: KeyPlatform,
  changes: Readonly<Record<string, readonly string[] | null>>,
): StoredKeybindings {
  const next: Record<string, readonly string[]> = { ...stored[platform] };
  for (const [id, chords] of Object.entries(changes)) {
    if (chords === null || sameAsTable(id, platform, chords)) delete next[id];
    else next[id] = chords;
  }
  return { ...stored, [platform]: next };
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

/** 번호 줄에서 누른 키의 modifier. 숫자를 같이 눌렀든 아니든 modifier만 본다. */
export function modifierOfInput(chord: string): string | null {
  const parsed = parseChord(chord);
  const parts = [
    ...(parsed.ctrl ? ["Ctrl"] : []),
    ...(parsed.meta ? ["Cmd"] : []),
    ...(parsed.alt ? ["Alt"] : []),
    ...(parsed.shift ? ["Shift"] : []),
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

export function bindingName(binding: Binding): string {
  return commandName(binding.command);
}
