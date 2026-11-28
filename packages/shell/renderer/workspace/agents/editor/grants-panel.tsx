// 다른 컴퓨터 앱 할당 화면. 사람이 이 agent에게 다른 컴퓨터의 앱을 붙이고, 앱을 펼쳐 tool마다 넣거나 뺀다. 바꾼 것은 바로 entries로 나간다.
// 이 컴퓨터의 앱은 할당이 아니라 skill 배포라 이 화면에 줄이 없다(Deployed skills).

import type { MessageKey } from "@lophn/i18n";
import { t } from "@lophn/i18n";
import { Switch } from "@lophn/ui/input";
import { Menu } from "@lophn/ui/overlay";
import { Button, Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { type ReactNode, useEffect, useState } from "react";

import type { AssignmentEntry } from "../../../../../protocol/approvals/assignment.ts";
import type { ToolEffect } from "../../../../../protocol/lophn-agent/tool-values.ts";
import { shortId } from "../../../desktop/connection/waiting/model.ts";
import {
  machineItemOf,
  useMachinesView,
} from "../../../desktop/machines/context.tsx";
import { useMachineHub } from "../../../desktop/machines/scope.tsx";
import {
  MachineStatus,
  statusParts,
} from "../../../desktop/machines/status.tsx";
import { actionIcons, commonIcons } from "../../../icons/mod.ts";
import { readComputerApps } from "../core-grants.ts";
import type { GrantApp } from "../source.ts";
import {
  appEntryOf,
  dropEntries,
  isAsk,
  isRemoved,
  setEntry,
  withToolAsk,
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
  readonly ask: boolean;
}

function GrantRow({
  target,
  onRemoved,
  onAsk,
}: {
  target: Target;
  onRemoved: (removed: boolean) => void;
  onAsk: (ask: boolean) => void;
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
      <span
        className={`${styles.toggleCell} ${styles.hiddenLabel}`}
        data-grant-ask={target.name}
      >
        <Switch
          label={t("agents.label.grant-ask-toggle", { tool: target.name })}
          checked={!target.removed && target.ask}
          disabled={target.removed}
          onCheckedChange={(on) => onAsk(on)}
        />
      </span>
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
      <span className={styles.headRight}>
        {t("agents.label.grant-col-ask")}
      </span>
      <span>{t("agents.label.grant-col-allowed")}</span>
    </li>
  );
}

/** 접고 펼 수 있는 앱 카드. onToggle이 없으면 tool 목록을 읽지 못해 이름과 빼기만 있는 카드다. */
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
  onToggle?: () => void;
  remove: { label: string; onClick: () => void };
  children?: ReactNode;
}) {
  return (
    <div className={styles.targetCard} data-grant-card={name}>
      <div className={styles.targetHead}>
        {onToggle === undefined ? (
          <span className={styles.expand}>
            {name}
            <span className={styles.targetSummary}>{summary}</span>
          </span>
        ) : (
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
        )}
        <Button
          size="sm"
          variant="ghost"
          icon={actionIcons.remove}
          onClick={remove.onClick}
        >
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
  readonly entries: readonly AssignmentEntry[];
  /** 바꾼 entries 전체. 부르는 쪽이 바로 저장한다. */
  readonly onChange: (entries: readonly AssignmentEntry[]) => void;
}

const NO_APPS: ReadonlyMap<string, readonly GrantApp[] | null> = new Map();

/**
 * 붙은 컴퓨터마다 그 컴퓨터가 내놓는 앱. 읽는 길은 그 컴퓨터의 core(범위 hub)라 연결된 컴퓨터만 읽고, 꺼진 컴퓨터는 목록에
 * 없다(저장된 줄로 그린다). 연결됐는데 읽지 못한 컴퓨터는 null이다. hub가 없는 화면은 다른 컴퓨터가 없다.
 */
function useComputerApps() {
  const hub = useMachineHub();
  const view = useMachinesView();
  const [apps, setApps] = useState(NO_APPS);
  const connected = (view?.machines ?? [])
    .filter((one) => one.status === "connected")
    .map((one) => one.id)
    .join(",");
  useEffect(() => {
    if (hub === null || connected === "") {
      setApps(NO_APPS);
      return;
    }
    let live = true;
    void Promise.all(
      connected
        .split(",")
        .map(
          async (id) => [id, await readComputerApps(hub.get(id).core)] as const,
        ),
    ).then((found) => {
      if (live) setApps(new Map(found));
    });
    return () => {
      live = false;
    };
  }, [hub, connected]);
  return { view, apps };
}

/** 이 agent에게 붙인 다른 컴퓨터의 앱. 붙은 것은 agent마다 다르다. 이 컴퓨터의 앱은 skill 배포가 닿게 한다(Deployed skills). */
export function GrantsPanel({ entries, onChange }: GrantsPanelProps) {
  const [open, setOpen] = useState<readonly string[]>([]);
  const { view, apps: computerApps } = useComputerApps();

  // 다른 컴퓨터: 명단의 컴퓨터와 이미 줄이 붙은 컴퓨터(명단에서 빠졌어도 줄은 남아 뺄 수 있다).
  const machines = [
    ...new Set([
      ...(view?.machines ?? []).map((one) => one.id),
      ...entries.flatMap((one) =>
        one.machine === undefined ? [] : [one.machine],
      ),
    ]),
  ];
  const machineName = (machine: string) =>
    machineItemOf(view, machine).name || shortId(machine);
  const assignable = machines.flatMap((machine, index) =>
    (computerApps.get(machine) ?? [])
      .filter((app) => appEntryOf(entries, app.app, machine) === undefined)
      .map((app, at) => ({
        id: `${machine}/${app.app}`,
        label: app.name,
        ...(at === 0
          ? { heading: machineName(machine), separatorBefore: index > 0 }
          : {}),
      })),
  );

  return (
    <div className={styles.grants}>
      {machines.length === 0 ? null : (
        <section data-grants-computers="">
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>
              {t("agents.heading.grants-computers")}
            </h2>
            <Menu
              trigger={
                <Button
                  size="sm"
                  icon={actionIcons.add}
                  disabled={assignable.length === 0}
                >
                  {t("agents.button.assign-app")}
                </Button>
              }
              items={assignable}
              onSelect={(id) => {
                const [machine, app] = id.split("/") as [
                  `mch_${string}`,
                  `app_${string}`,
                ];
                const found = computerApps
                  .get(machine)
                  ?.find((one) => one.app === app);
                if (found === undefined) return;
                onChange(
                  setEntry(entries, {
                    app,
                    machine,
                    name: found.name,
                    removed_tools: [],
                  }),
                );
              }}
            />
          </div>
          <p className={styles.lead}>{t("agents.notice.grants-computers")}</p>
          {entries.every((one) => one.machine === undefined) ? (
            <p className={styles.empty}>{t("agents.empty.grants-computers")}</p>
          ) : null}
          {machines.map((machine) => {
            const lines = entries.filter((one) => one.machine === machine);
            if (lines.length === 0) return null;
            const item = machineItemOf(view, machine);
            const read = computerApps.get(machine);
            return (
              <div
                key={machine}
                className={styles.computer}
                data-grant-computer={machine}
              >
                <h3 className={styles.computerHead}>
                  {machineName(machine)}
                  {view === null ? null : <MachineStatus machine={item} />}
                </h3>
                {lines.map((entry) => {
                  const found = read?.find((one) => one.app === entry.app);
                  const key = `${machine}/${entry.app}`;
                  const remove = {
                    label: t("agents.button.remove-app"),
                    onClick: () =>
                      onChange(
                        dropEntries(
                          entries,
                          (one) =>
                            one.machine !== machine || one.app !== entry.app,
                        ),
                      ),
                  };
                  // 목록을 읽지 못한 줄(꺼진 컴퓨터, 읽는 중, 목록을 읽지 못함, 그 컴퓨터에서 사라진 앱)은 저장된 이름으로만 그린다.
                  if (found === undefined) {
                    return (
                      <TargetCard
                        key={key}
                        name={entry.name!}
                        summary={
                          item.status !== "connected"
                            ? statusParts(item).label
                            : read === undefined
                              ? ""
                              : read === null
                                ? t("agents.label.grants-apps-unread", {
                                    machine: machineName(machine),
                                  })
                                : t("agents.label.grants-app-gone")
                        }
                        open={false}
                        remove={remove}
                      />
                    );
                  }
                  const used = found.tools.filter(
                    (tool) => !isRemoved(entry, tool.tool),
                  ).length;
                  return (
                    <TargetCard
                      key={key}
                      name={found.name}
                      summary={t("agents.label.grants-app-tools-summary", {
                        used,
                        total: found.tools.length,
                      })}
                      open={open.includes(key)}
                      onToggle={() =>
                        setOpen(
                          open.includes(key)
                            ? open.filter((one) => one !== key)
                            : [...open, key],
                        )
                      }
                      remove={remove}
                    >
                      {found.tools.map((tool) => (
                        <GrantRow
                          key={tool.tool}
                          target={{
                            name: tool.tool,
                            detail: tool.detail,
                            effect: tool.effect,
                            removed: isRemoved(entry, tool.tool),
                            ask: isAsk(entry, tool.tool),
                          }}
                          onRemoved={(removed) =>
                            onChange(
                              setEntry(
                                entries,
                                withToolRemoved(entry, tool.tool, removed),
                              ),
                            )
                          }
                          onAsk={(ask) =>
                            onChange(
                              setEntry(
                                entries,
                                withToolAsk(entry, tool.tool, ask),
                              ),
                            )
                          }
                        />
                      ))}
                    </TargetCard>
                  );
                })}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
