// Settings › Shell rules. 명령을 돌리기 전에 보는 규칙을 제품 기본(읽기만), 전역(Workspace), project별로 보고
// 고친다. 줄마다 바로 저장하고, 저장하지 못하면 그 줄에 오류를 보인다. pattern은 고치지 않고 지우고 다시 더한다.
import { useCallback, useState } from "react";
import { Button, IconButton } from "@lophn/ui/primitives";
import { Field, Input, Select } from "@lophn/ui/input";
import { ErrorState, Loading, Skeleton } from "@lophn/ui/feedback";
import { t } from "@lophn/wording";

import { PRODUCT_SHELL_RULES } from "../../../../../protocol/approvals/shell-rules.ts";
import { launcherIcons } from "../../../icons/mod.ts";
import { NamedControl } from "../general/named-control.tsx";
import { useReload } from "../use-reload.ts";
import styles from "../settings.module.css";
import own from "./shell-rules.module.css";
import { ACTION_OPTIONS } from "./model.ts";
import type {
  ShellRule,
  ShellRuleAction,
  ShellRuleLayer,
  ShellRulesSource,
  ShellRulesView,
  SourceResult,
} from "./source.ts";

interface ShellRulesPanelProps {
  source: ShellRulesSource;
}

type Loaded =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly view: ShellRulesView };

const layerKey = (layer: ShellRuleLayer) =>
  layer.kind === "global" ? "global" : layer.project;

const actionOptions = () =>
  ACTION_OPTIONS.map((one) => ({ value: one.value, label: t(one.label) }));

export function ShellRulesPanel({ source }: ShellRulesPanelProps) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  // 저장하지 못한 줄: `<층>:<줄 번호>` 또는 더하기 줄 `<층>:add`.
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(() => {
    void source.read().then((read) => {
      setLoaded(
        read.ok ? { state: "ready", view: read.value } : { state: "failed" },
      );
    });
  }, [source]);
  useReload(source, load);

  // 성공해도 실패해도 다시 읽는다. 실패하면 화면은 저장된 값으로 돌아간다.
  async function save(
    where: string,
    saving: Promise<SourceResult<null>>,
  ): Promise<boolean> {
    setFailed(null);
    const saved = await saving;
    if (!saved.ok) setFailed(where);
    load();
    return saved.ok;
  }

  if (loaded.state === "failed") {
    return (
      <ErrorState
        target={t("settings.label.shell-rules-target")}
        onRetry={() => {
          setLoaded({ state: "loading" });
          load();
        }}
      />
    );
  }
  const view = loaded.state === "ready" ? loaded.view : null;
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
        void save(`${layerKey(layer)}:${index}`, source.remove(layer, index))}
      onAction={(index, action) =>
        void save(
          `${layerKey(layer)}:${index}`,
          source.setAction(layer, index, action),
        )}
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
              t("settings.heading.shell-rules-workspace"),
              t("settings.note.shell-rules-workspace"),
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
              )
            )}
          </>
        )}
      </Loading>
    </div>
  );
}

function BuiltIn(
  { kind, label, rules }: {
    kind: string;
    label: string;
    rules: readonly ShellRule[];
  },
) {
  return (
    <details className={own.builtIn} data-built-in={kind}>
      <summary className={own.summary}>{label}</summary>
      <ul className={own.patterns}>
        {rules.map((rule) => <li key={rule.pattern}>{rule.pattern}</li>)}
      </ul>
    </details>
  );
}

function RuleSection(
  { layer, title, note, rules, failed, onAdd, onRemove, onAction }: {
    layer: ShellRuleLayer;
    title: string;
    note: string;
    rules: readonly ShellRule[];
    failed: string | null;
    onAdd: (rule: ShellRule) => Promise<boolean>;
    onRemove: (index: number) => void;
    onAction: (index: number, action: ShellRuleAction) => void;
  },
) {
  const key = layerKey(layer);
  return (
    <section className={styles.groupBlock} data-layer={key}>
      <h2 className={styles.groupTitle}>{title}</h2>
      <p className={`${styles.lineHelp} ${own.note}`}>{note}</p>
      <ul className={styles.lines}>
        {rules.length === 0
          ? (
            <li className={`${styles.line} ${styles.lineHelp}`}>
              {t("settings.empty.shell-rules")}
            </li>
          )
          : rules.map((rule, index) => (
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
                      {failed === `${key}:${index}`
                        ? (
                          <span className={styles.rejected} role="alert">
                            {t("settings.error.value-not-saved")}
                          </span>
                        )
                        : null}
                    </div>
                    <div className={own.control}>
                      <div className={own.select}>
                        {provide(
                          <Select
                            options={actionOptions()}
                            value={rule.action}
                            onValueChange={(next) =>
                              onAction(index, next as ShellRuleAction)}
                          />,
                        )}
                      </div>
                      <IconButton
                        icon={launcherIcons.remove}
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
          ))}
        <AddRow
          failed={failed === `${key}:add`}
          onAdd={onAdd}
        />
      </ul>
    </section>
  );
}

function AddRow(
  { failed, onAdd }: {
    failed: boolean;
    onAdd: (rule: ShellRule) => Promise<boolean>;
  },
) {
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
            icon={launcherIcons.addRule}
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
