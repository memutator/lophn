// activity bar의 Workflows panel 본문. workflow 줄 하나가 run 줄처럼 아이콘, 이름, 아래 줄이다. 누르면 그 workflow의 탭을 연다.
import { TriangleAlert, Workflow } from "lucide-react";
import { Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";

import type { WorkflowEntry } from "../../../../packages/protocol/workflows/mod.ts";
import styles from "./workflow.module.css";

const PROBLEM_LABEL = {
  no_declaration: "No declaration file",
  invalid_yaml: "Declaration isn't valid YAML",
  invalid_declaration: "Declaration is invalid",
  not_agent: "Flow · can't be started here",
} as const;

function metaOf(entry: WorkflowEntry, running: number): string {
  if (entry.problem !== null) return PROBLEM_LABEL[entry.problem.reason];
  return running === 0 ? "Nothing running" : `${running} running`;
}

export function SidebarWorkflows(
  { entries, running, open, onOpen }: {
    entries: readonly WorkflowEntry[];
    /** workflow 이름별로 도는 instance 수. */
    running: Readonly<Record<string, number>>;
    /** 탭이 열려 있는 workflow 이름. */
    open: string | null;
    onOpen: (name: string) => void;
  },
) {
  if (entries.length === 0) {
    return (
      <p className={styles.panelEmpty}>
        No workflows yet. Ask the Project Manager to write one.
      </p>
    );
  }
  return (
    <ul className={styles.wfList} aria-label="Workflows">
      {entries.map((entry) => {
        const count = running[entry.name] ?? 0;
        const invalid = entry.state === "invalid";
        return (
          <li key={entry.name}>
            <button
              type="button"
              className={styles.wfRow}
              data-active={entry.name === open || undefined}
              data-workflow={entry.name}
              title={entry.problem?.message}
              onClick={() => onOpen(entry.name)}
            >
              <span
                className={styles.wfIcon}
                data-tone={invalid ? "critical" : undefined}
              >
                <Icon
                  icon={invalid ? TriangleAlert : Workflow}
                  pixels={iconPixels("base")}
                />
              </span>
              <span className={styles.wfText}>
                <span className={styles.wfName}>{entry.name}</span>
                <span
                  className={styles.wfMeta}
                  data-tone={invalid ? "critical" : undefined}
                >
                  {metaOf(entry, count)}
                </span>
              </span>
              {count > 0
                ? <span className={styles.wfDot} aria-hidden="true" />
                : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
