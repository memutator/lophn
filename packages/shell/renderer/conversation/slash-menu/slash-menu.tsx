// 입력칸에서 `/`를 치면 composer 위로 뜨는 명령 메뉴. 아이콘·이름·인자 hint·설명이 한 줄인 얇은 행이다. 글자가 없으면
// 머리 글이 있는 묶음(lophn, harness, Skills, Plugins & MCP, Custom)이고, 글자를 치면 순위대로 선 한 목록이며 줄 끝에
// 출처 배지가 붙는다. 목록·거르기·순위는 모델이 계산해 props로 주고, 이 component는 받은 줄을 그리며 query와 맞는
// 글자를 굵게 한다. 일하는 중 고른 명령이 다음 turn에 들어간다는 것은 아래 안내 줄이 말한다.
import { type ComponentProps, Fragment, type ReactNode } from "react";
import { Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/i18n";

import type { AcpCommandOpens } from "../../../../protocol/acp/mod.ts";
import { HARNESS_ADAPTERS } from "../../../../protocol/coding-agent/harness-adapter.ts";
import type { HarnessId } from "../../../../protocol/coding-agent/harness-id.ts";
import {
  commonIcons,
  conversationIcons,
  editorIcons,
  homeIcons,
  settingsIcons,
} from "../../icons/mod.ts";
import {
  harnessVendorOf,
  VendorIcon,
} from "../../parts/vendor-icon/vendor-icon.tsx";
import { slashRows } from "../agent-view-model.ts";
import styles from "./slash-menu.module.css";
import type {
  SlashEntryView,
  SlashGroupKey,
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
  /** harness id. 묶음 머리와 harness 줄의 아이콘·배지가 이 harness를 가리킨다. lophn은 null이다. */
  harness: string | null;
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

// lophn 앱 동작의 아이콘은 이름이 아니라 열 화면 동작으로 고른다.
const OPENS_ICONS: Readonly<Record<AcpCommandOpens, IconType>> = {
  new: conversationIcons.newSession,
  rename: editorIcons.edit,
  archive: commonIcons.archive,
  compact: editorIcons.compareChangesOnly,
  fork: editorIcons.compare,
  rewind: conversationIcons.rewind,
  model: conversationIcons.model,
  effort: conversationIcons.effort,
  mode: conversationIcons.mode,
  permissions: commonIcons.settings,
  status: homeIcons.details,
  usage: conversationIcons.usage,
  context: conversationIcons.context,
  mcp: settingsIcons.providers,
  skills: settingsIcons.tools,
  subagents: conversationIcons.subagents,
  tasks: conversationIcons.tasks,
  goal: conversationIcons.goal,
};

const SOURCE_ICONS: Readonly<
  Record<Exclude<SlashEntryView["source"], "app" | "harness">, IconType>
> = {
  skill: conversationIcons.skill,
  plugin: settingsIcons.extensionPackages,
  mcp: settingsIcons.providers,
  custom_user: conversationIcons.customUser,
  custom_project: conversationIcons.customProject,
};

function harnessLabel(harness: string | null): string {
  return harness !== null && harness in HARNESS_ADAPTERS
    ? HARNESS_ADAPTERS[harness as HarnessId].label
    : (harness ?? "");
}

function HarnessIcon({ harness }: { harness: string | null }): ReactNode {
  const vendor = harness === null ? undefined : harnessVendorOf(harness);
  return vendor === undefined ? (
    <Icon icon={settingsIcons.tools} pixels={iconPixels("small")} />
  ) : (
    <VendorIcon vendor={vendor} size={iconPixels("small")} />
  );
}

function iconOf(entry: SlashEntryView, harness: string | null): ReactNode {
  if (entry.source === "harness") return <HarnessIcon harness={harness} />;
  const icon =
    entry.source === "app"
      ? entry.opens === null
        ? settingsIcons.tools
        : OPENS_ICONS[entry.opens]
      : SOURCE_ICONS[entry.source];
  return <Icon icon={icon} pixels={iconPixels("small")} />;
}

const GROUP_TITLES = {
  app: "conversation.label.slash-group-app",
  skill: "conversation.label.slash-group-skills",
  extension: "conversation.label.slash-group-extensions",
  custom: "conversation.label.slash-group-custom",
} as const;

const BADGES = {
  app: "conversation.label.slash-badge-app",
  skill: "conversation.label.slash-badge-skill",
  plugin: "conversation.label.slash-badge-plugin",
  mcp: "conversation.label.slash-badge-mcp",
  custom_user: "conversation.label.slash-badge-user",
  custom_project: "conversation.label.slash-badge-project",
} as const;

function badgeOf(entry: SlashEntryView, harness: string | null): string {
  return entry.source === "harness"
    ? harnessLabel(harness)
    : t(BADGES[entry.source]);
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

function Row({
  entry,
  harness,
  query,
  selected,
  badge,
  onPick,
}: {
  entry: SlashEntryView;
  harness: string | null;
  query: string;
  selected: boolean;
  /** query가 있어 묶음 머리가 없을 때 줄 끝에 단다. */
  badge: boolean;
  onPick: (entry: SlashEntryView) => void;
}) {
  return (
    <div
      role="option"
      className={styles.row}
      aria-selected={selected}
      data-highlighted={selected ? "" : undefined}
      data-command={entry.name}
      data-source={entry.source}
      onClick={() => onPick(entry)}
    >
      <span className={styles.icon}>{iconOf(entry, harness)}</span>
      <span className={styles.label} data-slash-label="">
        {mark(`/${entry.name}`, query)}
        {entry.alias === null ? null : (
          <span className={styles.dim}> ({entry.alias})</span>
        )}
      </span>
      {entry.argumentHint === null ? null : (
        <span className={styles.hint}>{entry.argumentHint}</span>
      )}
      <span className={styles.description} data-slash-description="">
        {mark(entry.description, query)}
      </span>
      {badge ? (
        <span className={styles.badge} data-slash-badge="">
          {badgeOf(entry, harness)}
        </span>
      ) : null}
    </div>
  );
}

function GroupHead({
  group,
  harness,
}: {
  group: SlashGroupView;
  harness: string | null;
}) {
  return (
    <div className={styles.groupHead} data-slash-group-head={group.key}>
      {group.key === "harness" ? (
        <>
          <HarnessIcon harness={harness} />
          {harnessLabel(harness)}
        </>
      ) : (
        t(GROUP_TITLES[group.key as Exclude<SlashGroupKey, "harness">])
      )}
    </div>
  );
}

// 입력칸 위에 뜨는 메뉴. 줄을 위에서 아래로 센 번호가 highlightedIndex이고, 키보드로 옮기는 일은 부모가 한다.
export function SlashMenu({
  agentName,
  harness,
  query,
  working,
  state,
  highlightedIndex,
  onPick,
}: SlashMenuProps) {
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
  if (slashRows(state).length === 0) {
    return (
      <div className={classes}>
        <p className={styles.notice}>
          {t("conversation.notice.slash-no-match")}
        </p>
      </div>
    );
  }
  const row = (entry: SlashEntryView, at: number, badge: boolean) => (
    <Row
      key={`${entry.source}:${entry.name}`}
      entry={entry}
      harness={harness}
      query={query}
      selected={at === highlightedIndex}
      badge={badge}
      onPick={onPick}
    />
  );
  let before = 0;
  return (
    <div
      className={classes}
      role="listbox"
      aria-label={t("conversation.label.slash-menu")}
    >
      {state.kind === "ranked"
        ? state.entries.map((entry, at) => row(entry, at, true))
        : state.groups.map((group, index) => {
            const first = before;
            before += group.entries.length;
            return (
              <Fragment key={group.key}>
                {index === 0 ? null : <hr className={styles.rule} />}
                <div role="group" data-slash-group="">
                  <GroupHead group={group} harness={harness} />
                  {group.entries.map((entry, at) =>
                    row(entry, first + at, false),
                  )}
                </div>
              </Fragment>
            );
          })}
      {working ? (
        <p className={styles.note} data-slash-working="">
          {t("conversation.notice.slash-working", { agent: agentName })}
        </p>
      ) : null}
    </div>
  );
}
