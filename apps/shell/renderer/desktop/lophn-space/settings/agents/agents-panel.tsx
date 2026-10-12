import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Button,
  ErrorState,
  Loading,
  Skeleton,
  Switch,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import { ModelEditor } from "./model-editor.tsx";
import { modelLine, optionsLine, providerName } from "./model.ts";
import type {
  AgentsSettingsSource,
  AgentsSettingsView,
  DefaultSlot,
  ModelChoice,
  ServerStatus,
  SourceResult,
} from "./settings-source.ts";
import settings from "../settings.module.css";
import styles from "./agents.module.css";

export interface AgentsPanelProps {
  source: AgentsSettingsSource;
}

// Settings › Agents(shell/desktop#R50). 모든 project에 적용되는 기본값이고 project나 Operator가
// 바꾸지 않은 칸이 따르는 값이다. 위에서 아래로 Default models(lophn·Context Engineer·App Engineer·
// Operators 넷, 줄마다 model과 option 값과 [Change]), Model for summaries(한 줄), Instructions for
// all projects(LOPHN.md 미리보기와 [Edit]), Skills (all projects)([Add skill]), MCP servers
// (all projects)([Add server]) 순이다. [Change]는 그 줄 아래에 model 목록과 고른 model의
// option 축을 여는 editor를 하나만 연다. General에는 Models·Instructions 칸이 없다.
// agent-I30

type Loaded =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly view: AgentsSettingsView };

type Notice = "next-run" | "stale" | "failed";

const ROLE_SLOTS: readonly DefaultSlot[] = [
  "lophn",
  "context_engineer",
  "app_engineer",
  "operator",
];

function slotLabel(slot: DefaultSlot): string {
  switch (slot) {
    case "lophn":
      return t("settings.label.role-lophn");
    case "context_engineer":
      return t("settings.label.role-context-engineer");
    case "app_engineer":
      return t("settings.label.role-app-engineer");
    case "operator":
      return t("settings.label.role-operator");
    case "summaries":
      return t("settings.heading.agents-summaries");
  }
}

function statusText(status: ServerStatus): string {
  switch (status) {
    case "connected":
      return t("settings.label.status-connected");
    case "needs-sign-in":
      return t("settings.label.status-needs-sign-in");
    case "off":
      return t("settings.label.off");
  }
}

export function AgentsPanel({ source }: AgentsPanelProps): ReactNode {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [editing, setEditing] = useState<DefaultSlot | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  const load = useCallback(() => {
    void source.read().then((result) => {
      if (!alive.current) return;
      // 다시 읽다 실패해도 보이던 값은 그대로 둔다. 처음 읽기만 읽지 못했다고 보인다.
      setLoaded((was) =>
        result.ok
          ? { state: "ready", view: result.value }
          : was.state === "ready"
          ? was
          : { state: "failed" }
      );
    });
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

  // 바꾼 뒤에는 최신 값을 다시 읽어 보인다. 비교 기준(settingsSeq)도 그때 새로 받는다.
  async function save(
    current: AgentsSettingsView,
    slot: DefaultSlot,
    choice: ModelChoice,
  ): Promise<void> {
    setBusy(true);
    setNotice(null);
    const saved = await source.changeDefault(
      slot,
      choice,
      current.settingsSeq,
    );
    if (!alive.current) return;
    setBusy(false);
    if (saved.ok) {
      setEditing(null);
      setNotice("next-run");
    } else if (saved.code === "conflict") {
      setEditing(null);
      setNotice("stale");
    } else {
      setNotice("failed");
      return;
    }
    load();
  }

  // 한 번 부르고 실패하면 알린다. 값이 바뀌었을 수 있으니 어느 쪽이든 다시 읽는다.
  async function act(call: () => Promise<SourceResult<null>>): Promise<void> {
    setNotice(null);
    const done = await call();
    if (!alive.current) return;
    if (!done.ok) setNotice(done.code === "conflict" ? "stale" : "failed");
    load();
  }

  function row(current: AgentsSettingsView, slot: DefaultSlot): ReactNode {
    const choice = current.defaults[slot];
    const options = choice === null ? null : optionsLine(current, choice);
    return (
      <li key={slot} className={styles.slot}>
        <div className={settings.row} data-slot={slot}>
          <span className={settings.rowText}>
            <span className={settings.subheading} data-slot-label="">
              {slotLabel(slot)}
            </span>
            <span className={settings.text} data-slot-value="">
              {choice === null ? t("settings.label.not-chosen") : modelLine(
                providerName(current, choice.provider),
                choice.modelName,
              )}
            </span>
            {options === null
              ? null
              : (
                <span className={settings.muted} data-slot-options="">
                  {options}
                </span>
              )}
          </span>
          <Button
            size="sm"
            variant="secondary"
            data-action="change"
            aria-expanded={editing === slot}
            onClick={() => setEditing(editing === slot ? null : slot)}
          >
            {t("settings.button.change")}
          </Button>
        </div>
        {editing === slot
          ? (
            <div data-editor={slot} className={styles.editorSlot}>
              <ModelEditor
                view={current}
                current={choice}
                busy={busy}
                onSave={(next) => void save(current, slot, next)}
                onCancel={() => setEditing(null)}
              />
            </div>
          )
          : null}
      </li>
    );
  }

  return (
    <Loading loading={view === null} placeholder={<Skeleton lines={6} />}>
      {view === null ? null : (
        <div className={settings.groups} data-agents="">
          <p className={settings.text}>{t("settings.agents.intro")}</p>
          {notice === null ? null : notice === "next-run"
            ? (
              <p
                className={settings.notice}
                role="status"
                data-note="next-run"
              >
                {t("settings.notice.next-run")}
              </p>
            )
            : (
              <p
                className={settings.notice}
                role="status"
                data-notice={notice}
              >
                {notice === "stale"
                  ? t("settings.error.changed")
                  : t("settings.agents.action-failed")}
              </p>
            )}
          <section className={settings.section}>
            <h2 className={settings.heading}>
              {t("settings.heading.agents-defaults")}
            </h2>
            <ul className={settings.rows}>
              {ROLE_SLOTS.map((slot) => row(view, slot))}
            </ul>
          </section>
          <section className={settings.section}>
            <h2 className={settings.heading}>
              {t("settings.heading.agents-summaries")}
            </h2>
            <ul className={settings.rows}>{row(view, "summaries")}</ul>
          </section>
          <section className={settings.section}>
            <div className={settings.cardHead}>
              <h2 className={settings.heading}>
                {t("settings.heading.agents-instructions")}
              </h2>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void act(() => source.openInstructions())}
              >
                {t("settings.button.edit")}
              </Button>
            </div>
            {view.instructionsPreview === null
              ? (
                <p className={settings.empty} data-instructions-empty="">
                  {t("settings.agents.no-instructions")}
                </p>
              )
              : (
                <pre className={styles.preview} data-instructions-preview="">
                  {view.instructionsPreview}
                </pre>
              )}
          </section>
          <section className={settings.section} data-section="skills">
            <div className={settings.cardHead}>
              <h2 className={settings.heading}>
                {t("settings.heading.agents-skills")}
              </h2>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void act(() => source.addSkill())}
              >
                {t("settings.button.add-skill")}
              </Button>
            </div>
            {view.skills.length === 0
              ? (
                <p className={settings.empty} data-empty="">
                  {t("settings.agents.no-skills")}
                </p>
              )
              : (
                <ul className={settings.rows}>
                  {view.skills.map((skill) => (
                    <li
                      key={skill.name}
                      className={settings.row}
                      data-skill={skill.name}
                    >
                      <span className={settings.rowText}>
                        <Switch
                          label={skill.name}
                          checked={skill.enabled}
                          onCheckedChange={(value) =>
                            void act(() =>
                              source.setSkillEnabled(skill.name, value)
                            )}
                        />
                        <span
                          className={settings.muted}
                          data-extension-detail=""
                        >
                          {skill.detail}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
          </section>
          <section className={settings.section} data-section="servers">
            <div className={settings.cardHead}>
              <h2 className={settings.heading}>
                {t("settings.heading.agents-servers")}
              </h2>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void act(() => source.addServer())}
              >
                {t("settings.button.add-server")}
              </Button>
            </div>
            {view.servers.length === 0
              ? (
                <p className={settings.empty} data-empty="">
                  {t("settings.agents.no-servers")}
                </p>
              )
              : (
                <ul className={settings.rows}>
                  {view.servers.map((server) => (
                    <li
                      key={server.name}
                      className={settings.row}
                      data-server={server.name}
                    >
                      <span className={settings.rowText}>
                        <Switch
                          label={server.name}
                          checked={server.enabled}
                          onCheckedChange={(value) =>
                            void act(() =>
                              source.setServerEnabled(server.name, value)
                            )}
                        />
                        <span
                          className={settings.muted}
                          data-extension-detail=""
                        >
                          {server.detail}
                        </span>
                      </span>
                      <span className={settings.text} data-server-status="">
                        {statusText(server.status)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
          </section>
        </div>
      )}
    </Loading>
  );
}
