import { ErrorState, Loading, Skeleton } from "@lophn/ui/feedback";
import { t } from "@lophn/i18n";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { modelDefaultRead } from "../../../../../protocol/lophn-agent/models.ts";
import { InstructionsEditor } from "../../../workspace/agents/editor/instructions-editor.tsx";
import { DefaultModelField } from "../../../workspace/agents/editor/model-field.tsx";
import type { ModelsView } from "../../../workspace/agents/source.ts";
import { useCoreRead } from "../../connection/core-read.ts";
import styles from "./agents.module.css";
import { CallPolicySection } from "./call-policy-section.tsx";
import type {
  AgentsSettingsSource,
  InstructionsFile,
  ModelChoice,
} from "./settings-source.ts";

interface AgentsPanelProps {
  source: AgentsSettingsSource;
}

// Settings › Agents. 모든 project에 적용되는 기본값이다. 위에서 아래로 전역 기본 model 하나, 모든 project의
// 지침(LOPHN.md), 호출 정책이다. 지침은 이 자리에서 [Edit]으로 고친다. agent별 기본 model은 이 화면에 없고,
// lophn은 workspace마다 있어 그 workspace의 Agents 탭에서 고친다. Skills와 MCP server는 Tools and skills에 있다.

/** 지침은 core가 아니라 main file 통로라 열 때 한 번 읽는다. 못 읽으면 빈 칸으로 보인다. */
const NO_INSTRUCTIONS: InstructionsFile = { text: "", hash: null };

export function AgentsPanel({ source }: AgentsPanelProps): ReactNode {
  // 기본 model은 다른 창이나 agent가 바꿔도 따라간다. model 목록(picker)도 같은 `models` 변경에 다시 읽는다.
  const { loaded, reload } = useCoreRead(modelDefaultRead, {});
  const [models, setModels] = useState<ModelsView | null>(null);
  const [instructions, setInstructions] = useState<InstructionsFile | null>(
    null,
  );
  // 실패는 그 칸 바로 아래에 보인다. 화면 위쪽 한 줄은 무엇이 안 됐는지 말하지 못한다.
  const [failed, setFailed] = useState(false);
  // 고른 model은 저장이 끝나기 전에도 바로 보인다. 다음에 읽은 값이 오면 그 값을 보인다.
  const [picked, setPicked] = useState<ModelChoice | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    void source.readInstructions().then((read) => {
      if (alive.current)
        setInstructions(read.ok ? read.value : NO_INSTRUCTIONS);
    });
  }, [source]);
  const value = loaded.state === "ready" ? loaded.value : null;
  useEffect(() => {
    if (value === null) return;
    setPicked(null);
    void source.editor.models().then((read) => {
      if (alive.current && read.ok) setModels(read.value);
    });
  }, [source, value]);
  const view = useMemo(
    () =>
      value === null || instructions === null
        ? null
        : {
            defaultModel: value.default as ModelChoice | null,
            instructions,
          },
    [value, instructions],
  );

  if (loaded.state === "failed") {
    return (
      <ErrorState target={t("settings.label.agents-target")} onRetry={reload} />
    );
  }

  async function changeModel(choice: ModelChoice): Promise<void> {
    setFailed(false);
    const done = await source.changeDefaultModel(choice);
    if (!alive.current) return;
    if (!done.ok) {
      setFailed(true);
      setPicked(null);
    }
  }

  const chosen = picked ?? view?.defaultModel ?? null;

  return (
    <Loading loading={view === null} placeholder={<Skeleton lines={6} />}>
      {view === null ? null : (
        <div className={styles.page} data-agents-screen="list">
          <h1 className={styles.title}>{t("settings.label.tab-agents")}</h1>
          <p className={styles.lead}>
            {t("agents.notice.settings-agents-lead")}
          </p>

          <section>
            <h2 className={styles.sectionTitle}>
              {t("agents.heading.settings-default-model")}
            </h2>
            <p className={styles.sectionLead}>
              {t("agents.notice.settings-default-model-help")}
            </p>
            <DefaultModelField
              models={models}
              source={source.editor}
              value={chosen}
              error={
                failed
                  ? t("agents.error.settings-model-save-failed")
                  : undefined
              }
              onChange={(choice) => {
                setPicked(choice);
                void changeModel(choice);
              }}
            />
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>
              {t("settings.heading.agents-instructions")}
            </h2>
            <p className={styles.sectionLead}>
              {t("agents.notice.settings-instructions-help")}
            </p>
            <InstructionsEditor
              head={t("agents.label.settings-instructions-path")}
              file={view.instructions}
              empty={t("settings.agents.no-instructions")}
              port={{
                read: async () => {
                  const read = await source.readInstructions();
                  return read.ok ? read : { ok: false, message: read.code };
                },
                write: async (text, hash) => {
                  const written = await source.writeInstructions(text, hash);
                  return written.ok
                    ? written
                    : { ok: false, message: written.code };
                },
              }}
            />
            <p className={`${styles.note} ${styles.after}`}>
              {t("agents.notice.settings-tools-elsewhere")}
            </p>
          </section>

          <CallPolicySection source={source.callPolicy} />
        </div>
      )}
    </Loading>
  );
}
