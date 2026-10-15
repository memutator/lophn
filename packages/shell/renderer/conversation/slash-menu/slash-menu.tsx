// 입력칸에서 `/`를 치면 composer 위로 뜨는 명령 메뉴.
// 목록·묶음·거르기·예약 이름은 lophn-agent/commands(registry·list)가 계산해 props로 주고, 이 component는
// 받은 묶음을 순서대로 그리며 query와 맞는 글자를 굵게 한다. renderer는 contracts·design·sdk만 import하므로
// 그 모듈을 부르는 연결은 core source 쪽 몫이다.
import { type ReactNode, useId } from "react";
import { t } from "@lophn/wording";

import styles from "./slash-menu.module.css";
import type {
  SlashEntryView,
  SlashGroupView,
  SlashMenuState,
} from "./types.ts";

export type {
  SlashEntryView,
  SlashGroupView,
  SlashMenuState,
} from "./types.ts";

export interface SlashMenuProps {
  /** 둘째 묶음 이름이자 "Not while … is working"의 주어. */
  agentName: string;
  /** `/` 뒤에 친 글자. 맞는 글자를 굵게 하는 데만 쓰고 거르기는 하지 않는다. */
  query: string;
  /** 일하는 중인지(run이 돌거나 질문·승인을 기다림). */
  working: boolean;
  state: SlashMenuState;
  /** 보이는 줄을 위에서 아래로 센 번호. 키보드 이동은 부모가 한다. */
  highlightedIndex: number;
  /** 줄을 골랐다. 일하는 중에 못 쓰는(흐린) 줄은 부르지 않는다. */
  onPick: (entry: SlashEntryView) => void;
}

const ORIGIN_LABEL = {
  builtin: "conversation.label.slash-origin-builtin",
  global: "conversation.label.slash-origin-global",
  project: "conversation.label.slash-origin-project",
} as const;

// 글자가 단어 머리에서 맞는 곳을 굵게 한다. 거르기가 단어 머리 기준이라 같은 기준으로 맞춘다.
// 굵게 하는 것은 보이는 모양뿐이라 글 자체는 그대로 읽힌다.
function mark(text: string, query: string): ReactNode {
  if (query === "") return text;
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  let at = lower.indexOf(needle);
  while (at !== -1) {
    if (at > 0 && /[\p{L}\p{N}]/u.test(text[at - 1])) {
      at = lower.indexOf(needle, at + 1);
      continue;
    }
    parts.push(
      text.slice(from, at),
      <strong key={at} className={styles.hit}>
        {text.slice(at, at + needle.length)}
      </strong>,
    );
    from = at + needle.length;
    at = lower.indexOf(needle, from);
  }
  parts.push(text.slice(from));
  return parts;
}

function Row(
  { entry, query, agentName, working, selected, onPick }: {
    entry: SlashEntryView;
    query: string;
    agentName: string;
    working: boolean;
    selected: boolean;
    onPick: (entry: SlashEntryView) => void;
  },
) {
  const blocked = working && entry.whileRunning === "blocked";
  return (
    <div
      role="option"
      className={styles.row}
      aria-selected={selected}
      aria-disabled={blocked || undefined}
      data-command={entry.name}
      data-origin={entry.skillOrigin ?? undefined}
      data-blocked={blocked ? "" : undefined}
      onClick={() => {
        if (!blocked) onPick(entry);
      }}
    >
      <span className={styles.label} data-slash-label="">
        {mark(entry.title ?? entry.name, query)}
      </span>
      {entry.skillOrigin === null
        ? null
        : (
          <span className={styles.origin} data-slash-origin="">
            {t(ORIGIN_LABEL[entry.skillOrigin])}
          </span>
        )}
      <span className={styles.description} data-slash-description="">
        {mark(entry.description, query)}
      </span>
      {blocked
        ? (
          <span className={styles.reason} data-slash-reason="">
            {t("conversation.label.slash-blocked", { agent: agentName })}
          </span>
        )
        : null}
    </div>
  );
}

function Group(
  { group, first, query, agentName, working, highlightedIndex, onPick }: {
    group: SlashGroupView;
    /** 이 묶음 앞에 있는 줄 수. 위에서 센 번호를 이어 가려고 받는다. */
    first: number;
    query: string;
    agentName: string;
    working: boolean;
    highlightedIndex: number;
    onPick: (entry: SlashEntryView) => void;
  },
) {
  const heading = useId();
  return (
    <div
      role="group"
      aria-labelledby={heading}
      data-slash-group=""
      data-source={group.source}
    >
      <p id={heading} className={styles.heading} data-slash-heading="">
        {group.title}
      </p>
      {group.entries.map((entry, index) => (
        <Row
          key={`${entry.name}/${entry.skillOrigin ?? ""}`}
          entry={entry}
          query={query}
          agentName={agentName}
          working={working}
          selected={first + index === highlightedIndex}
          onPick={onPick}
        />
      ))}
    </div>
  );
}

// 입력칸 위에 뜨는 메뉴. 줄을 위에서 아래로 센 번호가 highlightedIndex이고, 키보드로 옮기는 일은 부모가 한다.
export function SlashMenu(
  { agentName, query, working, state, highlightedIndex, onPick }:
    SlashMenuProps,
) {
  if (state.kind === "unknown") {
    return (
      <div className={styles.menu}>
        <p className={styles.notice} role="status">
          {t("conversation.label.slash-unknown", { name: state.name })}
        </p>
      </div>
    );
  }
  if (state.kind === "choose_skill") {
    return (
      <div
        className={styles.menu}
        role="listbox"
        aria-label={t("conversation.label.slash-menu")}
      >
        <p className={styles.notice} data-slash-choose="">
          {t("conversation.notice.slash-choose", { name: state.name })}
        </p>
        {state.candidates.map((entry, index) => (
          <Row
            key={`${entry.name}/${entry.skillOrigin ?? ""}`}
            entry={entry}
            query=""
            agentName={agentName}
            working={working}
            selected={index === highlightedIndex}
            onPick={onPick}
          />
        ))}
      </div>
    );
  }
  if (state.groups.length === 0) {
    return (
      <div className={styles.menu}>
        <p className={styles.notice}>
          {t("conversation.notice.slash-no-match")}
        </p>
      </div>
    );
  }
  let before = 0;
  return (
    <div
      className={styles.menu}
      role="listbox"
      aria-label={t("conversation.label.slash-menu")}
    >
      {state.groups.map((group) => {
        const first = before;
        before += group.entries.length;
        return (
          <Group
            key={group.source}
            group={group}
            first={first}
            query={query}
            agentName={agentName}
            working={working}
            highlightedIndex={highlightedIndex}
            onPick={onPick}
          />
        );
      })}
    </div>
  );
}
