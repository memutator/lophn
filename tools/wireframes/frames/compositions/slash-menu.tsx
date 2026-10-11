// 입력칸에 "/"를 치면 composer 위로 뜨는 명령 메뉴(Codex desktop 모양). 묶음 셋: 전역 built-in(Commands),
// agent별 built-in(그 agent 이름), Skills. 글자를 더 치면 이름이나 설명에 맞는 것만 남기고 맞는 글자를 굵게
// 보인다. 맞는 게 없는 묶음은 숨긴다. 작업 중에 못 쓰는 명령은 흐리게 하고 이유를 말한다.
import { Fragment, type ReactNode } from "react";

import menuStyles from "../../../../packages/design/components/menu/menu.module.css";
import {
  GLOBAL_COMMANDS,
  ROLE_COMMANDS,
  SKILL_COMMANDS,
  type SlashCommand,
  type SlashGroup,
} from "./agents-data.ts";
import a from "./agents.module.css";

/** 입력 글자가 `/`로 시작하고 공백이 아직 없으면 명령을 고르는 중이다. 그 뒤의 글자를 돌려준다. */
export function slashQuery(text: string): string | null {
  return text.startsWith("/") && !/\s/.test(text) ? text.slice(1) : null;
}

/** 이 agent의 묶음 셋. 둘째 묶음은 agent 이름을 달고, 없는 agent(Operator)는 둘째 묶음이 없다. */
export function slashGroups(agent: string): readonly SlashGroup[] {
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
            <p className={a.slashHead}>{group.title}</p>
            {group.items.map((item, index) => {
              const blocked = working && item.idleOnly === true;
              return (
                <div
                  key={item.name}
                  role="option"
                  aria-selected={groupIndex === 0 && index === 0}
                  aria-disabled={blocked || undefined}
                  className={`${menuStyles.item} ${a.slashRow}`}
                  data-highlighted={groupIndex === 0 && index === 0 && !blocked
                    ? ""
                    : undefined}
                  data-blocked={blocked ? "" : undefined}
                  onClick={() => {
                    if (!blocked) onPick(item, group.title);
                  }}
                >
                  <span className={a.slashName}>{mark(item.name, needle)}</span>
                  <span className={a.slashText}>{mark(item.text, needle)}</span>
                  {blocked
                    ? (
                      <span className={a.slashWhy}>
                        Not while {agent} is working
                      </span>
                    )
                    : null}
                </div>
              );
            })}
          </Fragment>
        ))}
    </div>
  );
}
