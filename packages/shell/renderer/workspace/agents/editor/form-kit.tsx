// 탭 컴포넌트가 같이 쓰는 조각: 칸 묶음(Group)과 거절된 항목(Issues).
import type { ReactNode } from "react";
import { t } from "@lophn/i18n";

import type { AgentDefinitionIssue } from "../../../../../protocol/lophn-agent/agent-definitions.ts";
import type { FieldName } from "./editor-model.ts";
import styles from "./agent-editor.module.css";

// `entries`가 있으면 `tools.2`처럼 목록 자리를 가리키는 issue에 그 이름을 붙인다.
export function Issues({
  issues,
  entries,
}: {
  issues: readonly AgentDefinitionIssue[];
  entries?: readonly string[];
}) {
  return issues.map((issue) => {
    const entry = entries?.[Number(issue.field.split(".")[1])];
    return (
      <p
        key={`${issue.field}/${issue.code}`}
        className={styles.issue}
        data-issue={issue.code}
      >
        {entry === undefined ? "" : `${entry}: `}
        {t("project-workspace.notice.agent-editor-issue", {
          code: issue.code.replace(/_(\w)/g, (_, c: string) => c.toUpperCase()),
        })}
      </p>
    );
  });
}

export function Group({
  name,
  heading,
  children,
}: {
  name: FieldName;
  heading: string;
  children: ReactNode;
}) {
  return (
    <fieldset className={styles.group} data-field={name}>
      <legend className={styles.legend}>{heading}</legend>
      {children}
    </fieldset>
  );
}
