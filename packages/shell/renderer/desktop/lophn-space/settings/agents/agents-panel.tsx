import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Avatar,
  Button,
  Card,
  ErrorState,
  Loading,
  Skeleton,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import { AgentEditor } from "../../../../workspace/agents/editor/agent-editor.tsx";
import { DefaultsTable } from "../../../../workspace/agents/editor/grants-panel.tsx";
import { DefaultModelField } from "../../../../workspace/agents/editor/model-field.tsx";
import { modelLabelOf } from "../../../../workspace/agents/model-picker-data.ts";
import type { ModelsView } from "../../../../workspace/agents/source.ts";
import type {
  AgentsSettingsSource,
  AgentsSettingsView,
  LophnSummary,
  ModelChoice,
  SourceResult,
} from "./settings-source.ts";
import styles from "./agents.module.css";

export interface AgentsPanelProps {
  source: AgentsSettingsSource;
}

// Settings › Agents. 모든 project에 적용되는 기본값이다. 위에서 아래로 전역 기본 model 하나, lophn 카드
// ([Open lophn settings]), 모든 project의 지침(LOPHN.md 미리보기와 [Edit]), grant 기본값 표다. role별 기본 model은 없다.
// lophn 카드는 같은 panel 안 둘째 화면을 열고, 거기는 project 없는 agent editor다. Skills와 MCP server는 Tools and skills에 있다.

type Loaded =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | {
    readonly state: "ready";
    readonly view: AgentsSettingsView;
    readonly models: ModelsView | null;
  };

type Screen = "list" | "lophn";

function modelLine(
  lophn: LophnSummary,
  fallback: ModelChoice | null,
  label: (choice: ModelChoice) => string,
): string {
  if (lophn.model !== null) {
    return t("agents.label.settings-lophn-model-own", {
      model: label(lophn.model),
    });
  }
  return fallback === null
    ? t("agents.label.settings-lophn-model-none")
    : t("agents.label.settings-lophn-model-default", {
      model: label(fallback),
    });
}

export function AgentsPanel({ source }: AgentsPanelProps): ReactNode {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [screen, setScreen] = useState<Screen>("list");
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
            : { state: "failed" }
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

  if (screen === "lophn") {
    const back = () => {
      setScreen("list");
      load();
    };
    return (
      <div className={styles.page} data-agents-screen="lophn">
        <div className={styles.backRow}>
          <Button size="sm" variant="ghost" onClick={back}>
            {t("agents.button.settings-back")}
          </Button>
        </div>
        <AgentEditor
          source={source.editor}
          project={null}
          projectName=""
          agent="lophn"
          contexts={[]}
          onDone={back}
          onChanged={() => {}}
          onEditProjectInstructions={() => {}}
        />
      </div>
    );
  }

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

  async function act(call: () => Promise<SourceResult<null>>): Promise<void> {
    setFailed(false);
    const done = await call();
    if (!alive.current) return;
    if (!done.ok) setFailed(true);
    load();
  }

  const chosen = picked ?? view?.defaultModel ?? null;

  return (
    <Loading loading={view === null} placeholder={<Skeleton lines={6} />}>
      {view === null
        ? null
        : (
          <div className={styles.page} data-agents-screen="list">
            <h1 className={styles.title}>{t("settings.label.tab-agents")}</h1>
            <p className={styles.lead}>
              {t("agents.notice.settings-agents-lead")}
            </p>
            {failed
              ? (
                <p className={styles.notice} role="status" data-notice="failed">
                  {t("settings.agents.action-failed")}
                </p>
              )
              : null}

            <section>
              <h2 className={styles.sectionTitle}>
                {t("agents.heading.settings-default-model")}
              </h2>
              <p className={styles.sectionLead}>
                {t("agents.notice.settings-default-model-help")}
              </p>
              <DefaultModelField
                models={models}
                value={chosen}
                onChange={(choice) => {
                  setPicked(choice);
                  void act(() => source.changeDefaultModel(choice));
                }}
              />
            </section>

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>
                {t("settings.label.role-lophn")}
              </h2>
              <Card>
                <div className={styles.cardHead}>
                  <h3 className={styles.cardTitle}>
                    <Avatar
                      profile={{ kind: "icon", icon: "dock" }}
                      size="md"
                    />
                    {view.lophn.name}
                  </h3>
                  <span className={styles.chip}>
                    {t("agents.label.settings-lophn-chip")}
                  </span>
                </div>
                <p className={styles.purpose}>
                  {t("agents.notice.settings-lophn-purpose")}
                </p>
                <ul className={styles.rows}>
                  <li data-lophn-model="">
                    {modelLine(view.lophn, chosen, modelLabelOf(models))}
                  </li>
                  <li data-lophn-grants="">
                    {t("agents.label.settings-lophn-grants", {
                      apps: view.lophn.apps,
                      agents: view.lophn.agents,
                      settings: view.lophn.mayChangeSettings ? "yes" : "no",
                    })}
                  </li>
                </ul>
                <div className={styles.actions}>
                  <Button
                    data-action="open-lophn"
                    onClick={() => setScreen("lophn")}
                  >
                    {t("agents.button.settings-open-lophn")}
                  </Button>
                </div>
              </Card>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>
                  {t("settings.heading.agents-instructions")}
                </h2>
                <Button
                  size="sm"
                  data-action="edit-instructions"
                  onClick={() => void act(() => source.openInstructions())}
                >
                  {t("settings.button.edit")}
                </Button>
              </div>
              <p className={styles.sectionLead}>
                <span className={styles.mono}>
                  {t("agents.label.settings-instructions-path")}
                </span>
              </p>
              {view.instructionsPreview === null
                ? (
                  <p className={styles.empty} data-instructions-empty="">
                    {t("settings.agents.no-instructions")}
                  </p>
                )
                : (
                  <pre className={styles.code} data-instructions-preview="">
                  {view.instructionsPreview}
                  </pre>
                )}
              <p className={styles.note}>
                {t("agents.notice.settings-tools-elsewhere")}
              </p>
            </section>

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>
                {t("agents.heading.settings-grant-defaults")}
              </h2>
              <p className={styles.sectionLead}>
                {t("agents.notice.settings-grant-defaults-help")}
              </p>
              <DefaultsTable />
            </section>
          </div>
        )}
    </Loading>
  );
}
