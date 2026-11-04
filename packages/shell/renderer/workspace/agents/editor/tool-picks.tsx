// bare agent가 고르는 tool. 그 place 종류의 내장 tool은 체크로 고르고, lophn 명령(`call.reply`), 앱 command(`<slug>.<command>`),
// MCP tool(`mcp__<server>__<tool>`)은 이름을 적어 더한다. 고른 이름 그대로 정의의 `tools`가 된다.
// 상한 안인지(place 종류 목록, 할당한 앱, 설정한 MCP)는 turn 조립이 본다.
import { useState } from "react";
import { Checkbox, Input } from "@lophn/ui/input";
import { Button } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";

import type { PlaceView } from "../source.ts";
import { actionIcons } from "../../../icons/mod.ts";
import styles from "./agent-editor.module.css";

// core `agent-places/tool-lists.ts`의 place 종류 목록(`lophn` tool 제외: 명령을 고른다)과 같아야 한다.
const COMMON = [
  "file.read",
  "file.glob",
  "file.grep",
  "file.outline",
  "pdf.read",
  "image.read",
  "web.search",
  "web.fetch",
  "ask",
  "skill.read",
  "visual.show",
] as const;
const WORK = ["file.write", "file.edit", "shell.run"] as const;

function builtinTools(place: PlaceView["kind"]): readonly string[] {
  return place === "none" ? COMMON : [...COMMON, ...WORK];
}

interface ToolPicksProps {
  readonly place: PlaceView["kind"];
  readonly value: readonly string[];
  readonly onChange: (tools: string[]) => void;
}

export function ToolPicks({ place, value, onChange }: ToolPicksProps) {
  const [draft, setDraft] = useState("");
  const builtin = builtinTools(place);
  const others = value.filter((name) => !builtin.includes(name));
  const toggle = (name: string, on: boolean) =>
    onChange(on ? [...value, name] : value.filter((one) => one !== name));
  const add = () => {
    const name = draft.trim();
    if (name !== "" && !value.includes(name)) onChange([...value, name]);
    setDraft("");
  };
  return (
    <>
      {builtin.map((name) => (
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
