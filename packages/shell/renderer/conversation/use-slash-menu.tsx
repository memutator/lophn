// composer 위 `/` 명령 메뉴가 source·키보드와 맞물리는 일.
// 목록·거르기는 source가 계산하고, 여기서는 열고 닫기, 줄 옮기기, 제출한 `/…`의 판정만 한다.
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import type { AgentTabSource } from "./agent-tab-source.ts";
import {
  type SlashEntryView,
  type SlashGroupView,
  SlashMenu,
  type SlashMenuState,
  slashQuery,
} from "./slash-menu/slash-menu.tsx";

interface SlashMenuInput {
  source: Pick<AgentTabSource, "commands">;
  session: string | null;
  /** 입력칸의 글. */
  text: string;
  agentName: string;
  /** 일하는 중이다. 고른 명령은 다음 turn에 들어간다. */
  working: boolean;
  /** 고른 명령을 실행한다. 입력칸을 비우는 일도 실행하는 쪽이 한다. */
  onRun: (entry: SlashEntryView, argument: string) => void;
  onProblem: () => void;
}

interface SlashMenuControl {
  /** composer 위에 놓을 메뉴. 닫혀 있으면 null이다. */
  menu: ReactNode | null;
  /** composer를 감싼 곳의 keydown. 입력칸에서 온 위아래·Esc만 본다. */
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  /** 입력칸이 `/…`일 때 Enter·보내기. */
  submit: () => Promise<void>;
}

function entriesOf(groups: readonly SlashGroupView[]): SlashEntryView[] {
  return groups.flatMap((group) => group.entries);
}

export function useSlashMenu(input: SlashMenuInput): SlashMenuControl {
  const { source, session, text, working, onProblem } = input;
  const query = slashQuery(text);
  const [listed, setListed] = useState<
    { query: string; groups: readonly SlashGroupView[] } | null
  >(null);
  const [unknown, setUnknown] = useState<SlashMenuState | null>(null);
  const [highlight, setHighlight] = useState(0);
  // Esc로 닫은 글. 글이 바뀌면 다시 열린다.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const latest = useRef(input);
  latest.current = input;

  useEffect(() => {
    if (query === null) {
      setListed(null);
      return;
    }
    let live = true;
    void source.commands(session, query).then((read) => {
      if (live && read.ok) setListed({ query, groups: read.value });
    });
    return () => {
      live = false;
    };
  }, [source, session, query]);

  // 글이 바뀌면 고른 줄과 알림은 처음으로 돌아간다.
  useEffect(() => {
    setHighlight(0);
    setUnknown(null);
  }, [text]);

  const open = unknown !== null ||
    (query !== null && listed?.query === query && dismissed !== text);
  const state: SlashMenuState | null = unknown ??
    (open && listed !== null ? { kind: "list", groups: listed.groups } : null);
  const rows = state?.kind === "list" ? entriesOf(state.groups) : [];

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!(event.target as HTMLElement).matches("[data-composer-input]")) return;
    if (state === null) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setUnknown(null);
      setDismissed(text);
      return;
    }
    if (rows.length === 0) return;
    const step = event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowUp"
      ? -1
      : 0;
    if (step === 0) return;
    event.preventDefault();
    setHighlight((current) => (current + step + rows.length) % rows.length);
  };

  const submit = async () => {
    const match = /^\/(\S*)(\s*)([\s\S]*)$/.exec(text)!;
    const [name, spaced, argument] = [match[1]!, match[2]! !== "", match[3]!];
    // 인자를 쓰는 중이면 메뉴가 닫혀 있다. 이름으로 목록을 새로 읽어 판정한다.
    const read = await source.commands(session, name);
    if (!read.ok) {
      onProblem();
      return;
    }
    const entries = entriesOf(read.value);
    // 이름만 쳤으면 고른 줄이 우선이고, 인자를 쳤으면 이름이 같은 것이다.
    const chosen = (spaced ? undefined : entries[highlight]) ??
      entries.find((entry) => entry.name === name);
    if (chosen === undefined) setUnknown({ kind: "unknown", name });
    else latest.current.onRun(chosen, argument.trim());
  };

  const menu = state === null ? null : (
    <SlashMenu
      agentName={input.agentName}
      query={query ?? ""}
      working={working}
      state={state}
      highlightedIndex={highlight}
      onPick={(entry) => latest.current.onRun(entry, "")}
    />
  );

  return { menu, onKeyDown, submit };
}
