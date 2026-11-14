// Settings › Shell rules. 명령을 돌리기 전에 보는 규칙을 제품 기본(읽기만), 전역, project별로 보고
// 고친다. 줄마다 바로 저장하고, 저장하지 못하면 그 줄에 오류를 보인다. pattern은 고치지 않고 지우고 다시 더한다.
import { useMemo, useState } from "react";
import { Button, IconButton } from "@lophn/ui/primitives";
import { Field, Input, Select } from "@lophn/ui/input";
import { ErrorState, Loading, Skeleton } from "@lophn/ui/feedback";
import { t } from "@lophn/i18n";

import {
  PRODUCT_SHELL_RULES,
  SHELL_RULES_SETTING_KEY,
} from "../../../../../protocol/approvals/shell-rules.ts";
import { settingsList } from "../../../../../protocol/config/file.ts";
import { projectApi } from "../../../../../protocol/projects/project-api.ts";
import { actionIcons } from "../../../icons/mod.ts";
import { useCoreRead } from "../../connection/core-read.ts";
import { effectiveOf } from "../declared.ts";
import { NamedControl } from "../general/named-control.tsx";
import { bothLoaded } from "../loaded.ts";
import styles from "../settings.module.css";
import own from "./shell-rules.module.css";
import { shellRulesViewOf } from "./core-source.ts";
import { ACTION_OPTIONS } from "./model.ts";
import type {
  ShellRule,
  ShellRuleAction,
  ShellRuleLayer,
  ShellRulesSource,
  SourceResult,
} from "./source.ts";

interface ShellRulesPanelProps {
  source: ShellRulesSource;
}

const layerKey = (layer: ShellRuleLayer) =>
  layer.kind === "global" ? "global" : layer.project;

const actionOptions = () =>
  ACTION_OPTIONS.map((one) => ({ value: one.value, label: t(one.label) }));

export function ShellRulesPanel({ source }: ShellRulesPanelProps) {
  const setting = useCoreRead(settingsList, {
    keys: [SHELL_RULES_SETTING_KEY],
  });
  const projects = useCoreRead(projectApi.list, {
    limit: Number.MAX_SAFE_INTEGER,
  });
  const loaded = useMemo(
    () =>
      bothLoaded(setting.loaded, projects.loaded, (value, listed) =>
        shellRulesViewOf(
          effectiveOf(value).get(SHELL_RULES_SETTING_KEY),
          listed.projects,
        ),
      ),
    [setting.loaded, projects.loaded],
  );
  // 저장하지 못한 줄: `<층>:<줄 번호>` 또는 더하기 줄 `<층>:add`.
  const [failed, setFailed] = useState<string | null>(null);

  // 저장한 값은 core가 낸 변경으로 다시 읽어 보인다. 실패하면 화면은 읽은 값 그대로다.
  async function save(
    where: string,
    saving: Promise<SourceResult<null>>,
  ): Promise<boolean> {
    setFailed(null);
    const saved = await saving;
    if (!saved.ok) setFailed(where);
    return saved.ok;
  }

  if (
    loaded.state === "failed" ||
    (loaded.state === "ready" && loaded.value === null)
  ) {
    return (
      <ErrorState
        target={t("settings.label.shell-rules-target")}
        onRetry={() => {
          setting.reload();
          projects.reload();
        }}
      />
    );
  }
  const view = loaded.state === "ready" ? loaded.value : null;
  const section = (
    layer: ShellRuleLayer,
    title: string,
    note: string,
    rules: readonly ShellRule[],
  ) => (
    <RuleSection
      key={layerKey(layer)}
      layer={layer}
      title={title}
      note={note}
      rules={rules}
      failed={failed}
      onAdd={(rule) => save(`${layerKey(layer)}:add`, source.add(layer, rule))}
      onRemove={(index) =>
        void save(`${layerKey(layer)}:${index}`, source.remove(layer, index))
      }
      onAction={(index, action) =>
        void save(
          `${layerKey(layer)}:${index}`,
          source.setAction(layer, index, action),
        )
      }
    />
  );
  return (
    <div data-shell-rules="">
      <h1 className={styles.paneTitle}>
        {t("settings.label.tab-shell-rules")}
      </h1>
      <p className={styles.lead}>{t("settings.intro.shell-rules")}</p>
      <Loading loading={view === null} placeholder={<Skeleton lines={3} />}>
        <section data-section="built-in">
          <h2 className={styles.groupTitle}>
            {t("settings.heading.shell-rules-built-in")}
          </h2>
          <BuiltIn
            kind="blocked"
            label={t("settings.label.shell-rules-blocked", {
              count: PRODUCT_SHELL_RULES.floor.length,
            })}
            rules={PRODUCT_SHELL_RULES.floor}
          />
          <BuiltIn
            kind="ask"
            label={t("settings.label.shell-rules-ask-first", {
              count: PRODUCT_SHELL_RULES.ask.length,
            })}
            rules={PRODUCT_SHELL_RULES.ask}
          />
          <p className={`${styles.lineHelp} ${styles.groupBlock}`}>
            {t("settings.note.shell-rules-built-in")}
          </p>
        </section>
        {view === null ? null : (
          <>
            {section(
              { kind: "global" },
              t("settings.heading.shell-rules-global"),
              t("settings.note.shell-rules-global"),
              view.global,
            )}
            {view.projects.map((project) =>
              section(
                { kind: "project", project: project.id },
                t("settings.heading.shell-rules-project", {
                  name: project.name,
                }),
                t("settings.note.shell-rules-project"),
                project.rules,
              ),
            )}
          </>
        )}
      </Loading>
    </div>
  );
}

function BuiltIn({
  kind,
  label,
  rules,
}: {
  kind: string;
  label: string;
  rules: readonly ShellRule[];
}) {
  return (
    <details className={own.builtIn} data-built-in={kind}>
      <summary className={own.summary}>{label}</summary>
      <ul className={own.patterns}>
        {rules.map((rule) => (
          <li key={rule.pattern}>{rule.pattern}</li>
        ))}
      </ul>
    </details>
  );
}

function RuleSection({
  layer,
  title,
  note,
  rules,
  failed,
  onAdd,
  onRemove,
  onAction,
}: {
  layer: ShellRuleLayer;
  title: string;
  note: string;
  rules: readonly ShellRule[];
  failed: string | null;
  onAdd: (rule: ShellRule) => Promise<boolean>;
  onRemove: (index: number) => void;
  onAction: (index: number, action: ShellRuleAction) => void;
}) {
  const key = layerKey(layer);
  return (
    <section className={styles.groupBlock} data-layer={key}>
      <h2 className={styles.groupTitle}>{title}</h2>
      <p className={`${styles.lineHelp} ${own.note}`}>{note}</p>
      <ul className={styles.lines}>
        {rules.length === 0 ? (
          <li className={`${styles.line} ${styles.lineHelp}`}>
            {t("settings.empty.shell-rules")}
          </li>
        ) : (
          rules.map((rule, index) => (
            <li
              key={`${index}:${rule.pattern}`}
              className={styles.line}
              data-shell-rule={rule.pattern}
            >
              <NamedControl
                name={rule.pattern}
                invalid={failed === `${key}:${index}`}
                labelClass={`${styles.lineName} ${styles.mono} ${own.pattern}`}
              >
                {({ label, provide }) => (
                  <>
                    <div className={styles.lineMain}>
                      {label}
                      {failed === `${key}:${index}` ? (
                        <span className={styles.rejected} role="alert">
                          {t("settings.error.value-not-saved")}
                        </span>
                      ) : null}
                    </div>
                    <div className={own.control}>
                      <div className={own.select}>
                        {provide(
                          <Select
                            options={actionOptions()}
                            value={rule.action}
                            onValueChange={(next) =>
                              onAction(index, next as ShellRuleAction)
                            }
                          />,
                        )}
                      </div>
                      <IconButton
                        icon={actionIcons.remove}
                        label={t("settings.button.remove-entry", {
                          item: rule.pattern,
                        })}
                        variant="ghost"
                        onClick={() => onRemove(index)}
                      />
                    </div>
                  </>
                )}
              </NamedControl>
            </li>
          ))
        )}
        <AddRow failed={failed === `${key}:add`} onAdd={onAdd} />
      </ul>
    </section>
  );
}

function AddRow({
  failed,
  onAdd,
}: {
  failed: boolean;
  onAdd: (rule: ShellRule) => Promise<boolean>;
}) {
  const [pattern, setPattern] = useState("");
  const [action, setAction] = useState<ShellRuleAction>("allow");
  const text = pattern.trim();
  async function add(): Promise<void> {
    if (text === "") return;
    if (await onAdd({ pattern: text, action })) setPattern("");
  }
  return (
    <li className={styles.line} data-add-rule="">
      <div className={styles.lineMain}>
        <Field
          label={t("settings.label.shell-rule-pattern")}
          error={failed ? t("settings.error.value-not-saved") : undefined}
        >
          <Input
            value={pattern}
            onChange={(event) => setPattern(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void add();
            }}
          />
        </Field>
      </div>
      <div className={styles.lineControl}>
        <Field label={t("settings.label.shell-rule-action")}>
          <Select
            options={actionOptions()}
            value={action}
            onValueChange={(next) => setAction(next as ShellRuleAction)}
          />
        </Field>
        <div className={styles.endSlot}>
          <Button
            size="sm"
            icon={actionIcons.add}
            disabled={text === ""}
            onClick={() => void add()}
          >
            {t("settings.button.add-rule")}
          </Button>
        </div>
      </div>
    </li>
  );
}
