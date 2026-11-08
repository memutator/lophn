import { ErrorState, Loading, Skeleton } from "@lophn/ui/feedback";
import { t } from "@lophn/i18n";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { InstructionsEditor } from "../../../workspace/agents/editor/instructions-editor.tsx";
import { DefaultModelField } from "../../../workspace/agents/editor/model-field.tsx";
import type { ModelsView } from "../../../workspace/agents/source.ts";
import styles from "./agents.module.css";
import { CallPolicySection } from "./call-policy-section.tsx";
import type {
  AgentsSettingsSource,
  AgentsSettingsView,
  ModelChoice,
} from "./settings-source.ts";

interface AgentsPanelProps {
  source: AgentsSettingsSource;
}

// Settings › Agents. 모든 project에 적용되는 기본값이다. 위에서 아래로 전역 기본 model 하나, 모든 project의
// 지침(LOPHN.md), 호출 정책이다. 지침은 이 자리에서 [Edit]으로 고친다. agent별 기본 model은 이 화면에 없고,
// lophn은 workspace마다 있어 그 workspace의 Agents 탭에서 고친다. Skills와 MCP server는 Tools and skills에 있다.

type Loaded =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | {
      readonly state: "ready";
      readonly view: AgentsSettingsView;
      readonly models: ModelsView | null;
    };

export function AgentsPanel({ source }: AgentsPanelProps): ReactNode {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  // 실패는 그 칸 바로 아래에 보인다. 화면 위쪽 한 줄은 무엇이 안 됐는지 말하지 못한다.
  const [failed, setFailed] = useState(false);
  // 고른 model은 저장이 끝나기 전에도 바로 보인다. 저장하지 못하면 읽은 값으로 돌아간다.
  const [picked, setPicked] = useState<ModelChoice | null>(null);
  const alive = useRef(true);

  const load = useCallback(() => {
    void Promise.all([source.read(), source.editor.models()]).then(
      ([read, models]) => {
        if (!alive.current) return;
        // 다시 읽다 실패해도 보이던 값은 그대로 둔다. 처음 읽기만 읽지 못했다고 보인다.
        setLoaded((was) =>
          read.ok
            ? {
                state: "ready",
                view: read.value,
                models: models.ok ? models.value : null,
              }
            : was.state === "ready"
              ? was
              : { state: "failed" },
        );
        if (read.ok) setPicked(null);
      },
    );
  }, [source]);
  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  if (loaded.state === "failed") {
    return (
      <ErrorState
        target={t("settings.label.agents-target")}
        onRetry={() => {
          setLoaded({ state: "loading" });
          load();
        }}
      />
    );
  }
  const view = loaded.state === "ready" ? loaded.view : null;
  const models = loaded.state === "ready" ? loaded.models : null;

  async function changeModel(choice: ModelChoice): Promise<void> {
    setFailed(false);
    const done = await source.changeDefaultModel(choice);
    if (!alive.current) return;
    if (!done.ok) setFailed(true);
    load();
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
