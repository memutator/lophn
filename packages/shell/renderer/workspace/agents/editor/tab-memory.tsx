// Memory 탭: 이 agent의 memory. 저장 전 agent는 memory가 아직 없다.
import { t } from "@lophn/i18n";

import { MEMORY_MAX_BYTES } from "../../../../../protocol/lophn-agent/tool-lists.ts";
import type { FormProps } from "./editor-model.ts";
import { Group } from "./form-kit.tsx";
import {
  InstructionsEditor,
  type InstructionsPort,
} from "./instructions-editor.tsx";
import styles from "./agent-editor.module.css";

/** memory가 보기에서 보이는 줄 수. */
const MEMORY_LINES = 4;

interface MemoryTabProps extends FormProps {
  /** 이 agent의 memory를 그 자리에서 고치는 길. 저장 전 agent는 쓰지 않는다. */
  readonly memoryPort: InstructionsPort;
}

export function MemoryTab(props: MemoryTabProps) {
  const { detail } = props;
  return (
    <div className={styles.form}>
      <Group name="memory" heading={t("agents.heading.memory")}>
        {detail.memory === null ? (
          <p className={styles.note}>
            {t("agents.notice.memory-agent-after-create")}
          </p>
        ) : (
          <>
            <InstructionsEditor
              head={t("agents.label.memory-head-agent")}
              file={detail.memory}
              lines={MEMORY_LINES}
              empty={t("agents.empty.memory")}
              port={props.memoryPort}
              limit={MEMORY_MAX_BYTES}
            />
            <p className={styles.note}>{t("agents.notice.memory-agent")}</p>
          </>
        )}
      </Group>
    </div>
  );
}
