// Settings › Permission rules. shell, file, app_tool, mcp_tool, local_tool 규칙을 제품 기본(읽기만), 전역, project별로
// category 묶음으로 보고 고친다. 지나치게 넓은 shell 허용 규칙은 지우지 않고 경고 표시만 붙인다.

import { t } from "@lophn/i18n";
import { ErrorState, Loading, Skeleton } from "@lophn/ui/feedback";
import { Field, Input, Select } from "@lophn/ui/input";
import { Button, IconButton } from "@lophn/ui/primitives";
import { useState } from "react";

import {
  PERMISSION_RULE_CATEGORIES,
  PERMISSION_RULES_SETTING_KEY,
  type PermissionRule,
  type PermissionRuleAction,
  type PermissionRuleCategory,
  PRODUCT_SHELL_RULES,
} from "../../../../../protocol/approvals/permission-rules.ts";
import { settingsList } from "../../../../../protocol/config/file.ts";
import { projectApi } from "../../../../../protocol/projects/project-api.ts";
import { actionIcons } from "../../../icons/mod.ts";
import {
  readRoute,
  readsOf,
  useFollowedRead,
} from "../../connection/core-read.ts";
import { effectiveOf } from "../declared.ts";
import { NamedControl } from "../general/named-control.tsx";
import styles from "../settings.module.css";
import { shellRulesViewOf } from "./core-source.ts";
import {
  ACTION_OPTIONS,
  CATEGORY_OPTIONS,
  categoryLabelKey,
  isBroadShellPattern,
} from "./model.ts";
import own from "./shell-rules.module.css";
import type {
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

const categoryOptions = () =>
  CATEGORY_OPTIONS.map((one) => ({ value: one.value, label: t(one.label) }));

const SETTING = { keys: [PERMISSION_RULES_SETTING_KEY] };
const ALL_PROJECTS = { limit: Number.MAX_SAFE_INTEGER };

function newRuleId(): string {
  return `rul_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export function ShellRulesPanel({ source }: ShellRulesPanelProps) {
  const { loaded, reload } = useFollowedRead<
    ReturnType<typeof shellRulesViewOf>
  >(
    async (core) => {
      const [setting, projects] = await Promise.all([
        readRoute(core, settingsList, SETTING),
        readRoute(core, projectApi.list, ALL_PROJECTS),
      ]);
      return setting.ok && projects.ok
        ? {
            ok: true as const,
            value: shellRulesViewOf(
              effectiveOf(setting.value).get(PERMISSION_RULES_SETTING_KEY),
              projects.value.projects,
            ),
          }
        : { ok: false as const };
    },
    [
      ...readsOf(settingsList, SETTING),
      ...readsOf(projectApi.list, ALL_PROJECTS),
    ],
    "",
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
        onRetry={reload}
      />
    );
  }
  const view = loaded.state === "ready" ? loaded.value : null;
  const section = (
    layer: ShellRuleLayer,
    title: string,
    note: string,
    rules: readonly PermissionRule[],
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
  rules: readonly PermissionRule[];
}) {
  return (
    <details className={own.builtIn} data-built-in={kind}>
      <summary className={own.summary}>{label}</summary>
      <ul className={own.patterns}>
        {rules.map((rule) => (
          <li key={rule.id}>{rule.pattern}</li>
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
  rules: readonly PermissionRule[];
  failed: string | null;
  onAdd: (rule: PermissionRule) => Promise<boolean>;
  onRemove: (index: number) => void;
  onAction: (index: number, action: PermissionRuleAction) => void;
}) {
  const key = layerKey(layer);
  const grouped = PERMISSION_RULE_CATEGORIES.map((category) => ({
    category,
    items: rules
      .map((rule, index) => ({ rule, index }))
      .filter(({ rule }) => rule.category === category),
  })).filter((group) => group.items.length > 0);

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
          grouped.map((group) => (
            <li
              key={group.category}
              className={own.categoryGroup}
              data-rule-category={group.category}
            >
              <div className={own.categoryHeader}>
                {t(categoryLabelKey(group.category))}
              </div>
              <ul className={own.categoryList}>
                {group.items.map(({ rule, index }) => {
                  const broad = isBroadShellPattern(rule);
                  return (
                    <li
                      key={`${rule.id}:${index}`}
                      className={styles.line}
                      data-shell-rule={rule.pattern}
                      data-rule-category-item={rule.category}
                      data-broad-warning={broad ? "" : undefined}
                    >
                      <NamedControl
                        name={rule.pattern}
                        invalid={failed === `${key}:${index}`}
                        labelClass={`${styles.lineName} ${styles.mono} ${own.pattern}`}
                      >
                        {({ label, provide }) => (
                          <>
                            <div className={styles.lineMain}>
                              <div className={own.ruleHead}>
                                {label}
                                {broad ? (
                                  <span
                                    className={own.broadBadge}
                                    data-broad-badge=""
                                  >
                                    {t("settings.label.rule-broad-warning")}
                                  </span>
                                ) : null}
                              </div>
                              {broad ? (
                                <span className={own.broadNote}>
                                  {t("settings.note.rule-broad-warning")}
                                </span>
                              ) : null}
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
                                      onAction(
                                        index,
                                        next as PermissionRuleAction,
                                      )
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
                  );
                })}
              </ul>
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
  onAdd: (rule: PermissionRule) => Promise<boolean>;
}) {
  const [category, setCategory] = useState<PermissionRuleCategory>("shell");
  const [pattern, setPattern] = useState("");
  const [action, setAction] = useState<PermissionRuleAction>("allow");
  const text = pattern.trim();
  async function add(): Promise<void> {
    if (text === "") return;
    if (
      await onAdd({
        id: newRuleId(),
        category,
        pattern: text,
        action,
      })
    ) {
      setPattern("");
    }
  }
  return (
    <li className={styles.line} data-add-rule="">
      <div className={styles.lineMain}>
        <div className={own.addFields}>
          <Field label={t("settings.label.rule-category")}>
            <Select
              options={categoryOptions()}
              value={category}
              onValueChange={(next) =>
                setCategory(next as PermissionRuleCategory)
              }
            />
          </Field>
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
      </div>
      <div className={styles.lineControl} data-rule-action="">
        <Field label={t("settings.label.shell-rule-action")}>
          <Select
            options={actionOptions()}
            value={action}
            onValueChange={(next) => setAction(next as PermissionRuleAction)}
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
