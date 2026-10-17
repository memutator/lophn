// agent grant 화면. 사람이 이 agent에게 앱, 외부 MCP tool, 부를 수 있는 다른 agent, 설정 고치기를 붙이고 대상마다 실행 때
// 묻는지를 정한다. 효과별 기본값을 위에 보이고, 앱은 펼치면 app-api마다 빼거나 묻는지를 바꾼다. 바꾼 것은 바로 entries로 나간다.
import { type ReactNode, useState } from "react";
import { Button, Icon } from "@lophn/ui/primitives";
import { Field, Select, Switch } from "@lophn/ui/input";
import { Menu } from "@lophn/ui/overlay";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/wording";
import type { MessageKey } from "@lophn/wording";

import type {
  AgentGrantEntry,
  AskSetting,
  Effect,
} from "../../../../../protocol/approvals/grants.ts";
import { commonIcons } from "../../../icons/mod.ts";
import type { GrantCatalog } from "../source.ts";
import {
  agentEntryOf,
  apiPick,
  appEntryOf,
  CALL_DEFAULT_ASK,
  callPick,
  defaultAskOf,
  dropEntries,
  KEPT,
  type Pick,
  setEntry,
  SETTINGS_EDIT_DEFAULT_ASK,
  settingsEntryOf,
  toolEntryOf,
  toolPick,
  withApiPick,
  withCallPick,
  withSettingsPick,
  withToolPick,
} from "./grants-model.ts";
import styles from "./grants-panel.module.css";

const ASK_LABEL: Record<AskSetting, MessageKey> = {
  never: "agents.label.ask-never",
  ask: "agents.label.ask-ask",
};
const EFFECT_LABEL: Record<Effect, MessageKey> = {
  read: "agents.label.effect-read",
  write: "agents.label.effect-write",
  external: "agents.label.effect-external",
};

const ASK_OPTIONS = (Object.keys(ASK_LABEL) as AskSetting[]).map((value) => ({
  value,
  label: t(ASK_LABEL[value]),
}));

/** 줄 하나가 그리는 대상. */
interface Target {
  readonly id: string;
  readonly name: string;
  readonly detail: string;
  /** 칸이 없으면 효과 칸을 그리지 않는다(부르기와 설정 고치기는 효과가 하나뿐이다). */
  readonly effect?: Effect;
  readonly defaultAsk: AskSetting;
  readonly pick: Pick;
  /** 새 release가 더한 app-api면 그 release 이름. */
  readonly addedIn?: string | null;
}

const changed = (target: Target) =>
  target.pick.ask !== undefined && target.pick.ask !== target.defaultAsk;

function GrantRow(
  { target, onPick }: { target: Target; onPick: (pick: Pick) => void },
) {
  const { pick } = target;
  const effect = target.effect !== undefined;
  const fresh = target.addedIn != null && !changed(target);
  return (
    <li
      className={`${styles.row} ${effect ? "" : styles.rowCall} ${
        pick.removed ? styles.removed : ""
      }`}
      data-grant-row={target.id}
    >
      <span className={styles.main}>
        <span className={styles.name}>{target.name}</span>
        <span className={styles.detail}>{target.detail}</span>
      </span>
      {target.effect === undefined
        ? null
        : <span className={styles.chip}>{t(EFFECT_LABEL[target.effect])}</span>}
      <span className={styles.status}>
        {pick.removed ? t("agents.label.grant-left-out") : changed(target)
          ? (
            <>
              {t("agents.label.grant-changed")}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onPick({ ...pick, ask: undefined })}
              >
                {t("agents.button.grant-reset")}
              </Button>
            </>
          )
          : fresh
          ? (
            <>
              <span className={`${styles.chip} ${styles.chipNew}`}>
                {t("agents.label.grant-new-in", { release: target.addedIn! })}
              </span>
              {t("agents.label.grant-came-default")}
            </>
          )
          : t("agents.label.grant-default")}
      </span>
      <span className={styles.hiddenLabel}>
        <Field label={t("agents.label.grant-when-runs", { name: target.name })}>
          <Select
            size="sm"
            options={ASK_OPTIONS}
            value={pick.ask ?? target.defaultAsk}
            disabled={pick.removed}
            onValueChange={(value) =>
              onPick({ ...pick, ask: value as AskSetting })}
          />
        </Field>
      </span>
      <span className={`${styles.toggleCell} ${styles.hiddenLabel}`}>
        <Switch
          label={target.name}
          checked={!pick.removed}
          onCheckedChange={(on) => onPick({ ...pick, removed: !on })}
        />
      </span>
    </li>
  );
}

function RowHead({ effect = true }: { effect?: boolean }) {
  return (
    <li
      className={`${styles.head} ${effect ? "" : styles.rowCall}`}
      aria-hidden="true"
    >
      <span>{t("agents.label.grant-col-name")}</span>
      {effect ? <span>{t("agents.label.grant-col-effect")}</span> : null}
      <span>{t("agents.label.grant-col-status")}</span>
      <span>{t("agents.label.grant-col-when")}</span>
      <span>{t("agents.label.grant-col-allowed")}</span>
    </li>
  );
}

/** 이름 목록 중 하나를 골라 더하는 menu 단추. 더할 것이 없으면 흐리다. */
function AssignMenu(
  { label, items, onAdd }: {
    label: string;
    items: readonly { id: string; label: string }[];
    onAdd: (id: string) => void;
  },
) {
  return (
    <Menu
      trigger={
        <Button
          size="sm"
          icon={commonIcons.add}
          disabled={items.length === 0}
        >
          {label}
        </Button>
      }
      items={[...items]}
      onSelect={onAdd}
    />
  );
}

/** 접고 펼 수 있는 대상 카드(앱 하나, MCP server 하나). */
function TargetCard(
  { name, summary, open, onToggle, remove, children }: {
    name: string;
    summary: string;
    open: boolean;
    onToggle: () => void;
    remove: { label: string; onClick: () => void };
    children: ReactNode;
  },
) {
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
      {open
        ? (
          <ul className={styles.rows}>
            <RowHead />
            {children}
          </ul>
        )
        : null}
    </div>
  );
}

const asking = (targets: readonly Target[]) =>
  targets.filter((target) =>
    !target.pick.removed &&
    (target.pick.ask ?? target.defaultAsk) === "ask"
  ).length;
const used = (targets: readonly Target[]) =>
  targets.filter((target) => !target.pick.removed).length;

/** 효과별 기본값 표. 묻는지의 시작 값이고 대상마다 바꿀 수 있다. */
export function DefaultsTable() {
  const rows: readonly {
    id: string;
    chip: MessageKey;
    ask: AskSetting;
    meaning: MessageKey;
  }[] = [
    {
      id: "read",
      chip: EFFECT_LABEL.read,
      ask: defaultAskOf("read"),
      meaning: "agents.label.defaults-read",
    },
    {
      id: "write",
      chip: EFFECT_LABEL.write,
      ask: defaultAskOf("write"),
      meaning: "agents.label.defaults-write",
    },
    {
      id: "external",
      chip: EFFECT_LABEL.external,
      ask: defaultAskOf("external"),
      meaning: "agents.label.defaults-external",
    },
    {
      id: "settings",
      chip: "agents.label.effect-settings",
      ask: SETTINGS_EDIT_DEFAULT_ASK,
      meaning: "agents.label.defaults-settings",
    },
  ];
  return (
    <div
      className={styles.defaults}
      role="table"
      aria-label={t("agents.label.defaults-by-effect")}
    >
      {rows.map((row) => (
        <div key={row.id} className={styles.contents} role="row">
          <span className={styles.chip} role="cell">{t(row.chip)}</span>
          <span className={styles.defaultsAsk} role="cell">
            {t(ASK_LABEL[row.ask])}
          </span>
          <span className={styles.defaultsMeaning} role="cell">
            {t(row.meaning)}
          </span>
        </div>
      ))}
    </div>
  );
}

interface GrantsPanelProps {
  readonly agentName: string;
  readonly entries: readonly AgentGrantEntry[];
  readonly catalog: GrantCatalog;
  /** 바꾼 entries 전체. 부르는 쪽이 바로 저장한다. */
  readonly onChange: (entries: readonly AgentGrantEntry[]) => void;
}

/** 이 agent에게 붙인 것과 묻는지. 붙은 것은 agent마다 다르다. */
export function GrantsPanel(
  { agentName, entries, catalog, onChange }: GrantsPanelProps,
) {
  const [open, setOpen] = useState<readonly string[]>([]);
  // MCP server 카드는 tool을 모두 뺀 뒤에도 남아 있어야 다시 켤 수 있다.
  const [servers, setServers] = useState<readonly string[]>(() =>
    catalog.mcpServers.filter((server) =>
      server.tools.some((tool) =>
        toolEntryOf(entries, server.server, tool.tool) !== undefined
      )
    ).map((server) => server.server)
  );
  const [openServers, setOpenServers] = useState<readonly string[]>(
    () => servers,
  );

  const toggled = (list: readonly string[], id: string) =>
    list.includes(id) ? list.filter((one) => one !== id) : [...list, id];

  const apps = catalog.apps.filter((app) =>
    appEntryOf(entries, app.app) !== undefined
  );
  const settingsOn = settingsEntryOf(entries) !== undefined;

  return (
    <div className={styles.grants}>
      <section>
        <p className={styles.lead}>
          {t("agents.notice.grants-lead", { name: agentName })}
        </p>
        <DefaultsTable />
        <p className={styles.note}>{t("agents.notice.grants-defaults-help")}</p>
      </section>

      <section>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>
            {t("agents.heading.grants-apps")}
          </h2>
          <AssignMenu
            label={t("agents.button.assign-app")}
            items={catalog.apps.filter((app) =>
              appEntryOf(entries, app.app) === undefined
            ).map((app) => ({ id: app.app, label: app.name }))}
            onAdd={(app) =>
              onChange(
                setEntry(entries, {
                  kind: "app",
                  app: app as `app_${string}`,
                  apis: [],
                }),
              )}
          />
        </div>
        {apps.length === 0
          ? <p className={styles.empty}>{t("agents.empty.grants-apps")}</p>
          : apps.map((app) => {
            const entry = appEntryOf(entries, app.app)!;
            const rows = app.apis.map((api): Target => ({
              id: api.api,
              name: api.api,
              detail: api.detail,
              effect: api.effect,
              defaultAsk: defaultAskOf(api.effect),
              pick: apiPick(entry, api.api),
              addedIn: api.addedIn,
            }));
            return (
              <TargetCard
                key={app.app}
                name={app.name}
                summary={app.release === null
                  ? t("agents.label.grants-apis-summary", {
                    used: used(rows),
                    total: rows.length,
                    asking: asking(rows),
                  })
                  : t("agents.label.grants-apps-summary", {
                    release: app.release,
                    used: used(rows),
                    total: rows.length,
                    asking: asking(rows),
                  })}
                open={open.includes(app.app)}
                onToggle={() => setOpen(toggled(open, app.app))}
                remove={{
                  label: t("agents.button.remove-app"),
                  onClick: () =>
                    onChange(dropEntries(
                      entries,
                      (one) => !(one.kind === "app" && one.app === app.app),
                    )),
                }}
              >
                {app.apis.map((api, index) => (
                  <GrantRow
                    key={api.api}
                    target={rows[index]}
                    onPick={(pick) =>
                      onChange(setEntry(
                        entries,
                        withApiPick(entry, api.api, api.effect, pick),
                      ))}
                  />
                ))}
              </TargetCard>
            );
          })}
      </section>

      <section>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>
            {t("agents.heading.grants-tools")}
          </h2>
          <AssignMenu
            label={t("agents.button.assign-tools")}
            items={catalog.mcpServers.filter((server) =>
              !servers.includes(server.server)
            ).map((server) => ({ id: server.server, label: server.server }))}
            onAdd={(name) => {
              const found = catalog.mcpServers.find((server) =>
                server.server === name
              );
              if (found === undefined) return;
              setServers([...servers, name]);
              setOpenServers([...openServers, name]);
              onChange(found.tools.reduce<readonly AgentGrantEntry[]>(
                (now, tool) =>
                  withToolPick(now, name, tool.tool, tool.effect, KEPT),
                entries,
              ));
            }}
          />
        </div>
        {servers.length === 0
          ? <p className={styles.empty}>{t("agents.empty.grants-tools")}</p>
          : catalog.mcpServers.filter((server) =>
            servers.includes(server.server)
          )
            .map((server) => {
              const rows = server.tools.map((tool): Target => ({
                id: tool.tool,
                name: tool.tool,
                detail: tool.detail,
                effect: tool.effect,
                defaultAsk: defaultAskOf(tool.effect),
                pick: toolPick(toolEntryOf(entries, server.server, tool.tool)),
              }));
              return (
                <TargetCard
                  key={server.server}
                  name={server.server}
                  summary={t("agents.label.grants-tools-summary", {
                    used: used(rows),
                    total: rows.length,
                    asking: asking(rows),
                  })}
                  open={openServers.includes(server.server)}
                  onToggle={() =>
                    setOpenServers(toggled(openServers, server.server))}
                  remove={{
                    label: t("agents.button.remove-server"),
                    onClick: () => {
                      setServers(
                        servers.filter((one) => one !== server.server),
                      );
                      onChange(dropEntries(
                        entries,
                        (one) =>
                          !(one.kind === "mcp_tool" &&
                            one.server === server.server),
                      ));
                    },
                  }}
                >
                  {server.tools.map((tool, index) => (
                    <GrantRow
                      key={tool.tool}
                      target={rows[index]}
                      onPick={(pick) =>
                        onChange(withToolPick(
                          entries,
                          server.server,
                          tool.tool,
                          tool.effect,
                          pick,
                        ))}
                    />
                  ))}
                </TargetCard>
              );
            })}
        <p className={styles.note}>{t("agents.notice.grants-tool-effect")}</p>
      </section>

      <section>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>
            {t("agents.heading.grants-agents")}
          </h2>
        </div>
        {catalog.agents.length === 0
          ? <p className={styles.empty}>{t("agents.empty.grants-agents")}</p>
          : (
            <ul className={`${styles.rows} ${styles.standalone}`}>
              <RowHead effect={false} />
              {catalog.agents.map((target) => {
                const entry = agentEntryOf(entries, target.agent);
                return (
                  <GrantRow
                    key={target.name + target.detail}
                    target={{
                      id: target.name,
                      name: target.name,
                      detail: target.detail,
                      defaultAsk: CALL_DEFAULT_ASK,
                      pick: callPick(entry),
                    }}
                    onPick={(pick) =>
                      onChange(withCallPick(entries, target.agent, pick))}
                  />
                );
              })}
            </ul>
          )}
      </section>

      <section>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>
            {t("agents.heading.grants-settings")}
          </h2>
        </div>
        <ul className={`${styles.rows} ${styles.standalone}`}>
          <GrantRow
            target={{
              id: "settings",
              name: t("agents.label.grants-settings-name"),
              detail: t("agents.label.grants-settings-detail"),
              defaultAsk: SETTINGS_EDIT_DEFAULT_ASK,
              pick: settingsOn
                ? {
                  removed: false,
                  ask: (settingsEntryOf(entries) as { setting?: AskSetting })
                    .setting,
                }
                : { removed: true },
            }}
            onPick={(pick) => onChange(
              withSettingsPick(entries, SETTINGS_EDIT_DEFAULT_ASK, pick),
            )}
          />
        </ul>
        <p className={styles.note}>{t("agents.notice.grants-settings-help")}</p>
      </section>
    </div>
  );
}
