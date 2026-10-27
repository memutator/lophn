// 할당 화면. 사람이 이 agent에게 앱을 붙이고, 앱을 펼쳐 tool마다 넣거나 뺀다. 바꾼 것은 바로 entries로 나간다.
// MCP server는 설정한 층이 곧 할당이라 이 화면에 줄이 없다.
import { type ReactNode, useState } from "react";
import { Button, Icon } from "@lophn/ui/primitives";
import { Switch } from "@lophn/ui/input";
import { Menu } from "@lophn/ui/overlay";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/wording";
import type { MessageKey } from "@lophn/wording";

import type { AssignmentEntry } from "../../../../../protocol/approvals/assignment.ts";
import type { ToolEffect } from "../../../../../protocol/lophn-agent/tool-values.ts";
import { commonIcons } from "../../../icons/mod.ts";
import type { GrantCatalog } from "../source.ts";
import {
  appEntryOf,
  dropEntries,
  isRemoved,
  setEntry,
  withToolRemoved,
} from "./grants-model.ts";
import styles from "./grants-panel.module.css";

const EFFECT_LABEL: Record<ToolEffect, MessageKey> = {
  read: "agents.label.effect-read",
  write: "agents.label.effect-write",
  external: "agents.label.effect-external",
};

/** 줄 하나가 그리는 tool. */
interface Target {
  readonly name: string;
  readonly detail: string;
  readonly effect: ToolEffect;
  readonly removed: boolean;
}

function GrantRow({
  target,
  onRemoved,
}: {
  target: Target;
  onRemoved: (removed: boolean) => void;
}) {
  return (
    <li
      className={`${styles.row} ${target.removed ? styles.removed : ""}`}
      data-grant-row={target.name}
    >
      <span className={styles.main}>
        <span className={styles.name}>{target.name}</span>
        <span className={styles.detail}>{target.detail}</span>
      </span>
      <span className={styles.chip}>{t(EFFECT_LABEL[target.effect])}</span>
      <span className={`${styles.toggleCell} ${styles.hiddenLabel}`}>
        <Switch
          label={target.name}
          checked={!target.removed}
          onCheckedChange={(on) => onRemoved(!on)}
        />
      </span>
    </li>
  );
}

function RowHead() {
  return (
    <li className={styles.head} aria-hidden="true">
      <span>{t("agents.label.grant-col-name")}</span>
      <span>{t("agents.label.grant-col-effect")}</span>
      <span>{t("agents.label.grant-col-allowed")}</span>
    </li>
  );
}

/** 접고 펼 수 있는 앱 카드. */
function TargetCard({
  name,
  summary,
  open,
  onToggle,
  remove,
  children,
}: {
  name: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  remove: { label: string; onClick: () => void };
  children: ReactNode;
}) {
  return (
    <div className={styles.targetCard} data-grant-card={name}>
      <div className={styles.targetHead}>
        <button
          type="button"
          className={styles.expand}
          aria-expanded={open}
          onClick={onToggle}
        >
          <Icon
            icon={open ? commonIcons.collapse : commonIcons.expand}
            pixels={iconPixels("small")}
          />
          {name}
          <span className={styles.targetSummary}>{summary}</span>
        </button>
        <Button size="sm" variant="ghost" onClick={remove.onClick}>
          {remove.label}
        </Button>
      </div>
      {open ? (
        <ul className={styles.rows}>
          <RowHead />
          {children}
        </ul>
      ) : null}
    </div>
  );
}

interface GrantsPanelProps {
  readonly agentName: string;
  readonly entries: readonly AssignmentEntry[];
  readonly catalog: GrantCatalog;
  /** 바꾼 entries 전체. 부르는 쪽이 바로 저장한다. */
  readonly onChange: (entries: readonly AssignmentEntry[]) => void;
}

/** 이 agent에게 붙인 앱. 붙은 것은 agent마다 다르다. */
export function GrantsPanel({
  agentName,
  entries,
  catalog,
  onChange,
}: GrantsPanelProps) {
  const [open, setOpen] = useState<readonly string[]>([]);

  const apps = catalog.apps.filter(
    (app) => appEntryOf(entries, app.app) !== undefined,
  );

  return (
    <div className={styles.grants}>
      <section>
        <p className={styles.lead}>
          {t("agents.notice.grants-lead", { name: agentName })}
        </p>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>
            {t("agents.heading.grants-apps")}
          </h2>
          <Menu
            trigger={
              <Button
                size="sm"
                icon={commonIcons.add}
                disabled={catalog.apps.length === apps.length}
              >
                {t("agents.button.assign-app")}
              </Button>
            }
            items={catalog.apps
              .filter((app) => appEntryOf(entries, app.app) === undefined)
              .map((app) => ({ id: app.app, label: app.name }))}
            onSelect={(app) =>
              onChange(
                setEntry(entries, {
                  app: app as `app_${string}`,
                  removed_tools: [],
                }),
              )
            }
          />
        </div>
        {apps.length === 0 ? (
          <p className={styles.empty}>{t("agents.empty.grants-apps")}</p>
        ) : (
          apps.map((app) => {
            const entry = appEntryOf(entries, app.app)!;
            const used = app.tools.filter(
              (tool) => !isRemoved(entry, tool.tool),
            ).length;
            return (
              <TargetCard
                key={app.app}
                name={app.name}
                summary={t("agents.label.grants-app-tools-summary", {
                  used,
                  total: app.tools.length,
                })}
                open={open.includes(app.app)}
                onToggle={() =>
                  setOpen(
                    open.includes(app.app)
                      ? open.filter((one) => one !== app.app)
                      : [...open, app.app],
                  )
                }
                remove={{
                  label: t("agents.button.remove-app"),
                  onClick: () =>
                    onChange(
                      dropEntries(entries, (one) => one.app !== app.app),
                    ),
                }}
              >
                {app.tools.map((tool) => (
                  <GrantRow
                    key={tool.tool}
                    target={{
                      name: tool.tool,
                      detail: tool.detail,
                      effect: tool.effect,
                      removed: isRemoved(entry, tool.tool),
                    }}
                    onRemoved={(removed) =>
                      onChange(
                        setEntry(
                          entries,
                          withToolRemoved(entry, tool.tool, removed),
                        ),
                      )
                    }
                  />
                ))}
              </TargetCard>
            );
          })
        )}
        <p className={styles.note}>{t("agents.notice.grants-mcp-layers")}</p>
      </section>
    </div>
  );
}
