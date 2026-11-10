// Instructions 탭: workspace 지침(그 자리에서 고친다)과 이 agent의 지침.
import { t } from "@lophn/i18n";

import type { AgentDetail } from "../source.ts";
import { type FormProps, issuesOf } from "./editor-model.ts";
import { Issues } from "./form-kit.tsx";
import type { InstructionsPort } from "./instructions-editor.tsx";
import { InstructionsBlock } from "./parts.tsx";
import styles from "./agent-editor.module.css";

function instructionsHead(detail: AgentDetail, workspaceName: string): string {
  const file = detail.instructions?.file ?? "LOPHN.md";
  return t("agents.label.instructions-head-placed", {
    file,
    workspace: detail.instructions?.workspace ?? workspaceName,
  });
}

interface InstructionsTabProps extends FormProps {
  /** workspace 지침을 그 자리에서 고치는 길. */
  readonly workspaceInstructions: InstructionsPort;
}

export function InstructionsTab(props: InstructionsTabProps) {
  const { detail, definition, onChange } = props;
  return (
    <div className={styles.form}>
      <InstructionsBlock
        workspace={detail.instructions}
        head={instructionsHead(detail, props.workspaceName)}
        port={props.workspaceInstructions}
        note={
          detail.instructions?.editable === false
            ? t("agents.notice.instructions-app-none")
            : undefined
        }
        value={definition.body}
        help={
          detail.instructions === null
            ? t("agents.notice.instructions-help-lophn")
            : t("agents.notice.instructions-help")
        }
        issues={<Issues issues={issuesOf(props.issues, "instructions")} />}
        onChange={(body) => onChange({ ...definition, body })}
      />
    </div>
  );
}
