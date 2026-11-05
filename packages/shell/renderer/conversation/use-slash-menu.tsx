// composer 위 `/` 명령 메뉴가 source·키보드와 맞물리는 일.
// 목록·거르기는 source가 계산하고, 여기서는 열고 닫기, 줄 옮기기, 제출한 `/…`의 판정만 한다.
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import type { AcpCommand } from "../../../protocol/acp/mod.ts";
import type { AgentTabSource } from "./agent-tab-source.ts";
import { slashGroupsOf } from "./agent-view-model.ts";
import {
  type SlashEntryView,
  type SlashGroupView,
  SlashMenu,
  type SlashMenuState,
  slashQuery,
} from "./slash-menu/slash-menu.tsx";

interface SlashMenuInput {
  source: Pick<AgentTabSource, "acp" | "draft">;
  session: string | null;
  /** 첫 읽기의 명령. 메뉴를 열 때 snapshot을 다시 읽어 새로 켠 skill을 반영하므로 그 전까지의 값이다. */
  commands: readonly AcpCommand[];
  /** 입력칸의 글. */
  text: string;
  agentName: string;
  /** 일하는 중이다. 고른 명령은 다음 turn에 들어간다. */
  working: boolean;
  /** 고른 명령을 실행한다. 입력칸을 비우는 일도 실행하는 쪽이 한다. */
  onRun: (entry: SlashEntryView, argument: string) => void;
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
  const { source, session, text, working } = input;
  const query = slashQuery(text);
  // 명령 목록은 snapshot에만 있고 skill이 바뀌어도 갱신이 없다. 메뉴를 열 때마다 다시 읽는다.
  const [fresh, setFresh] = useState<readonly AcpCommand[] | null>(null);
  const commands = fresh ?? input.commands;
  const opened = query !== null;
  useEffect(() => {
    if (!opened) return;
    let live = true;
    // 새 session 화면은 snapshot이 없어 draft를 다시 읽는다.
    const meta =
      session === null
        ? source.draft?.()
        : source
            .acp(session)
            .then((read) =>
              read.ok && read.value.session !== null
                ? { ok: true as const, value: read.value.session }
                : { ok: false as const },
            );
    void meta?.then((read) => {
      if (live && read.ok) setFresh(read.value.commands);
    });
    return () => {
      live = false;
    };
  }, [source, session, opened]);
  const listed =
    query === null
      ? null
      : { query, groups: slashGroupsOf(commands, query, session !== null) };
  const [unknown, setUnknown] = useState<SlashMenuState | null>(null);
  const [highlight, setHighlight] = useState(0);
  // Esc로 닫은 글. 글이 바뀌면 다시 열린다.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const latest = useRef(input);
  latest.current = input;

  // 글이 바뀌면 고른 줄과 알림은 처음으로 돌아간다.
  useEffect(() => {
    setHighlight(0);
    setUnknown(null);
  }, [text]);

  // 새 글자의 목록을 읽는 동안에도 앞 목록을 그대로 보인다. 읽은 목록이 올 때까지 닫으면 글자마다 menu가
  // 사라졌다 다시 떠서 밑의 대화가 비친다.
  const open =
    unknown !== null ||
    (query !== null && listed !== null && dismissed !== text);
  const state: SlashMenuState | null =
    unknown ??
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
    const step =
      event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    setHighlight((current) => (current + step + rows.length) % rows.length);
  };

  const submit = async () => {
    const match = /^\/(\S*)(\s*)([\s\S]*)$/.exec(text)!;
    const [name, spaced, argument] = [match[1]!, match[2]! !== "", match[3]!];
    // 인자를 쓰는 중이면 메뉴가 닫혀 있다. 이름으로 목록을 거르고 판정한다.
    const entries = entriesOf(slashGroupsOf(commands, name, session !== null));
    // 인자를 쳤으면 이름이 같은 것이다. 이름만 쳤으면 화살표로 고른 줄이 우선이다. 고르지 않았으면(첫 줄)
    // 이름이 꼭 맞는 명령이 이긴다. `/status`는 설명에 "status"가 든 MCP가 첫 줄이라 MCP가 돌던 일이 있다.
    const exact = entries.find((entry) => entry.name === name);
    const chosen = spaced
      ? exact
      : highlight === 0
        ? (exact ?? entries[0])
        : entries[highlight];
    if (chosen === undefined) setUnknown({ kind: "unknown", name });
    else latest.current.onRun(chosen, argument.trim());
  };

  const menu =
    state === null ? null : (
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
