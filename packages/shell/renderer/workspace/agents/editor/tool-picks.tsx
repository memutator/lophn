// bare agent가 고르는 tool. 내장 tool은 체크로 고르고, lophn 명령(`call.reply`), 앱 command(`<slug>.<command>`),
// MCP tool(`mcp__<server>__<tool>`)은 이름을 적어 더한다. 고른 이름 그대로 정의의 `tools`가 된다.
// 상한 안인지(workspace 종류 목록, 할당한 앱, 설정한 MCP)는 turn 조립이 본다.
import { useState } from "react";
import { Checkbox, Input } from "@lophn/ui/input";
import { Button } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";

import { WORKSPACE_KINDS } from "../../../../../protocol/lophn-agent/workspaces.ts";
import { workspaceToolNames } from "../../../../../protocol/lophn-agent/tool-lists.ts";
import { actionIcons } from "../../../icons/mod.ts";
import styles from "./agent-editor.module.css";

// 정의는 전역이고 어느 workspace에서도 열려서 모든 workspace 종류의 내장 tool을 보인다. `lophn` tool은 빼고 명령을 이름으로 고른다.
const BUILTIN: readonly string[] = [
  ...new Set(WORKSPACE_KINDS.flatMap((kind) => workspaceToolNames(kind))),
].filter((name) => name !== "lophn");

interface ToolPicksProps {
  readonly value: readonly string[];
  readonly onChange: (tools: string[]) => void;
}

export function ToolPicks({ value, onChange }: ToolPicksProps) {
  const [draft, setDraft] = useState("");
  const others = value.filter((name) => !BUILTIN.includes(name));
  const toggle = (name: string, on: boolean) =>
    onChange(on ? [...value, name] : value.filter((one) => one !== name));
  const add = () => {
    const name = draft.trim();
    if (name !== "" && !value.includes(name)) onChange([...value, name]);
    setDraft("");
  };
  return (
    <>
      {BUILTIN.map((name) => (
        <Checkbox
          key={name}
          size="sm"
          label={name}
          checked={value.includes(name)}
          onCheckedChange={(on) => toggle(name, on)}
        />
      ))}
      {others.map((name) => (
        <div key={name} className={styles.pickRow} data-tool-pick={name}>
          <span>{name}</span>
          <Button
            size="sm"
            icon={actionIcons.delete}
            aria-label={t("agents.button.remove-tool", { name })}
            onClick={() => toggle(name, false)}
          >
            {t("agents.button.remove-tool-short")}
          </Button>
        </div>
      ))}
      <div className={styles.pickRow}>
        <Input
          size="sm"
          value={draft}
          placeholder={t("agents.label.tools-add-placeholder")}
          aria-label={t("agents.label.tools-add")}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            add();
          }}
        />
        <Button size="sm" icon={actionIcons.add} onClick={add}>
          {t("agents.button.add-tool")}
        </Button>
      </div>
    </>
  );
}
