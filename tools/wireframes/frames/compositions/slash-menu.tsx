// 입력칸에 "/"를 치면 composer 위로 뜨는 명령 메뉴(Codex desktop 모양). 한 줄에 아이콘·이름·설명이 붙은 낮은 행이다.
// 묶음 셋(전역 built-in, agent별 built-in, Skills)은 얇은 선으로 나눈다. 글자를 더 치면 이름이나 설명에 맞는 것만 남기고 맞는 글자를 굵게
// 보인다. 맞는 게 없는 묶음은 숨긴다. agent가 일하는 중에 고른 명령은 다음 turn에 들어가서, 줄마다 그렇게 적는다.
import { type ComponentProps, Fragment, type ReactNode } from "react";
import { Icon, iconPixels } from "@lophn/design/components";
import {
  conversationIcons,
  editorIcons,
  lophnSpaceIcons,
  settingsIcons,
  workspaceIcons,
} from "../../../../packages/shell/renderer/icons/mod.ts";

import menuStyles from "../../../../packages/design/components/menu/menu.module.css";
import {
  GLOBAL_COMMANDS,
  ROLE_COMMANDS,
  SKILL_COMMANDS,
  type SlashCommand,
  type SlashGroup,
} from "./agents-data.ts";
import a from "./agents.module.css";

type IconType = ComponentProps<typeof Icon>["icon"];

/** 입력 글자가 `/`로 시작하고 공백이 아직 없으면 명령을 고르는 중이다. 그 뒤의 글자를 돌려준다. */
export function slashQuery(text: string): string | null {
  return text.startsWith("/") && !/\s/.test(text) ? text.slice(1) : null;
}

/** 이 agent의 묶음 셋. 둘째 묶음은 agent 이름을 달고, 없는 agent(Operator)는 둘째 묶음이 없다. */
function slashGroups(agent: string): readonly SlashGroup[] {
  const role = ROLE_COMMANDS[agent];
  return [
    GLOBAL_COMMANDS,
    ...(role === undefined ? [] : [{ title: agent, items: role }]),
    SKILL_COMMANDS,
  ];
}

function mark(text: string, needle: string): ReactNode {
  if (needle === "") return text;
  const at = text.toLowerCase().indexOf(needle);
  if (at === -1) return text;
  return (
    <>
      {text.slice(0, at)}
      <strong className={a.hit}>{text.slice(at, at + needle.length)}</strong>
      {text.slice(at + needle.length)}
    </>
  );
}

/** 명령마다 앞에 붙는 아이콘. skill은 모두 같은 아이콘이다. */
const ICONS: Readonly<Record<string, IconType>> = {
  Compact: editorIcons.compareChangesOnly,
  Recap: conversationIcons.result,
  Fork: editorIcons.compare,
  Rename: editorIcons.edit,
  Archive: lophnSpaceIcons.archive,
  "New session": conversationIcons.newSession,
  MCP: settingsIcons.connections,
  Skills: settingsIcons.extensions,
  Permissions: lophnSpaceIcons.settings,
  "New app": lophnSpaceIcons.apps,
  "Repair app": editorIcons.restore,
  "Check contracts": editorIcons.problem,
  "New context": workspaceIcons.context,
};
const SKILL_ICON = settingsIcons.extensions;

export function SlashMenu(
  { agent, query, working, onPick }: {
    agent: string;
    query: string;
    working: boolean;
    onPick: (command: SlashCommand, group: string) => void;
  },
) {
  const needle = query.toLowerCase();
  const groups = slashGroups(agent)
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        `${item.name} ${item.text}`.toLowerCase().includes(needle)
      ),
    }))
    .filter((group) => group.items.length > 0);
  return (
    <div
      className={`${menuStyles.menu} ${a.slashMenu}`}
      role="listbox"
      aria-label="Commands"
    >
      {groups.length === 0
        ? <p className={a.noMatch}>No commands match.</p>
        : groups.map((group, groupIndex) => (
          <Fragment key={group.title}>
            {groupIndex === 0 ? null : <hr className={a.slashRule} />}
            {group.items.map((item, index) => (
              <div
                key={item.name}
                role="option"
                aria-selected={groupIndex === 0 && index === 0}
                className={`${menuStyles.item} ${a.slashRow}`}
                data-highlighted={groupIndex === 0 && index === 0
                  ? ""
                  : undefined}
                onClick={() => onPick(item, group.title)}
              >
                <Icon
                  icon={group.title === SKILL_COMMANDS.title
                    ? SKILL_ICON
                    : ICONS[item.name] ?? SKILL_ICON}
                  pixels={iconPixels("small")}
                  className={a.slashIcon}
                />
                <span className={a.slashName}>{mark(item.name, needle)}</span>
                <span className={a.slashText}>{mark(item.text, needle)}</span>
                {working ? <span className={a.slashWhy}>Next turn</span> : null}
              </div>
            ))}
          </Fragment>
        ))}
      {working && groups.length > 0
        ? (
          <p className={a.slashNote}>
            {agent} is working. A command you pick goes in the next turn.
          </p>
        )
        : null}
    </div>
  );
}
