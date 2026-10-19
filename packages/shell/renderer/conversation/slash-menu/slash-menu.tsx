// 입력칸에서 `/`를 치면 composer 위로 뜨는 명령 메뉴. 아이콘·이름·설명이 한 줄인 얇은 행이고, 묶음(전역
// built-in, agent별 built-in, Skills)은 얇은 선으로 나눈다. 목록·거르기는 source가 계산해 props로 주고, 이
// component는 받은 묶음을 순서대로 그리며 query와 맞는 글자를 굵게 한다. 일하는 중 고른 명령은 모두 다음
// turn에 들어간다.
import { type ComponentProps, Fragment, type ReactNode } from "react";
import { Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/wording";

import {
  commonIcons,
  conversationIcons,
  editorIcons,
  settingsIcons,
} from "../../icons/mod.ts";
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

type IconType = ComponentProps<typeof Icon>["icon"];

interface SlashMenuProps {
  /** 일하는 중 안내 문구의 주어. */
  agentName: string;
  /** `/` 뒤에 친 글자. 맞는 글자를 굵게 하는 데만 쓰고 거르기는 하지 않는다. */
  query: string;
  /** 일하는 중인지. 그렇다면 줄마다 "Next turn"이 붙는다. */
  working: boolean;
  state: SlashMenuState;
  /** 보이는 줄을 위에서 아래로 센 번호. 키보드 이동은 부모가 한다. */
  highlightedIndex: number;
  onPick: (entry: SlashEntryView) => void;
}

/** 입력 글자가 `/`로 시작하고 공백이 아직 없으면 명령을 고르는 중이다. 그 뒤의 글자를 돌려준다. */
export function slashQuery(text: string): string | null {
  return text.startsWith("/") && !/\s/.test(text) ? text.slice(1) : null;
}

// 아이콘은 명령 이름으로 고른다. skill과 모르는 role 명령은 같은 아이콘이다.
const ICONS: Readonly<Record<string, IconType>> = {
  new: conversationIcons.newSession,
  rename: editorIcons.edit,
  archive: commonIcons.archive,
  compact: editorIcons.compareChangesOnly,
  fork: editorIcons.compare,
  mcp: settingsIcons.providers,
  skills: settingsIcons.tools,
  permissions: commonIcons.settings,
  recap: conversationIcons.result,
  "new-app": commonIcons.apps,
  "repair-app": editorIcons.restore,
  "check-contracts": editorIcons.problem,
};

function iconOf(entry: SlashEntryView): IconType {
  if (entry.source === "skill") return settingsIcons.tools;
  return ICONS[entry.name] ?? settingsIcons.tools;
}

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
  { entry, query, working, selected, onPick }: {
    entry: SlashEntryView;
    query: string;
    working: boolean;
    selected: boolean;
    onPick: (entry: SlashEntryView) => void;
  },
) {
  return (
    <div
      role="option"
      className={styles.row}
      aria-selected={selected}
      data-highlighted={selected ? "" : undefined}
      data-command={entry.name}
      onClick={() => onPick(entry)}
    >
      <Icon
        icon={iconOf(entry)}
        pixels={iconPixels("small")}
        className={styles.icon}
      />
      <span className={styles.label} data-slash-label="">
        {mark(entry.title ?? entry.name, query)}
      </span>
      <span className={styles.description} data-slash-description="">
        {mark(entry.description, query)}
      </span>
      {working
        ? (
          <span className={styles.why} data-slash-next="">
            {t("conversation.label.next-turn")}
          </span>
        )
        : null}
    </div>
  );
}

// 입력칸 위에 뜨는 메뉴. 줄을 위에서 아래로 센 번호가 highlightedIndex이고, 키보드로 옮기는 일은 부모가 한다.
export function SlashMenu(
  { agentName, query, working, state, highlightedIndex, onPick }:
    SlashMenuProps,
) {
  const classes = styles.menu;
  if (state.kind === "unknown") {
    return (
      <div className={classes}>
        <p className={styles.notice} role="status">
          {t("conversation.label.slash-unknown", { name: state.name })}
        </p>
      </div>
    );
  }
  if (state.groups.length === 0) {
    return (
      <div className={classes}>
        <p className={styles.notice}>
          {t("conversation.notice.slash-no-match")}
        </p>
      </div>
    );
  }
  let before = 0;
  return (
    <div
      className={classes}
      role="listbox"
      aria-label={t("conversation.label.slash-menu")}
    >
      {state.groups.map((group: SlashGroupView, index) => {
        const first = before;
        before += group.entries.length;
        return (
          <Fragment key={group.source}>
            {index === 0 ? null : <hr className={styles.rule} />}
            <div role="group" aria-label={group.title} data-slash-group="">
              {group.entries.map((entry, at) => (
                <Row
                  key={entry.name}
                  entry={entry}
                  query={query}
                  working={working}
                  selected={first + at === highlightedIndex}
                  onPick={onPick}
                />
              ))}
            </div>
          </Fragment>
        );
      })}
      {working
        ? (
          <p className={styles.note} data-slash-working="">
            {t("conversation.notice.slash-working", { agent: agentName })}
          </p>
        )
        : null}
    </div>
  );
}
