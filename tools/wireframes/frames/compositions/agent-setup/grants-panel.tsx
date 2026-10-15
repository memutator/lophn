// agent grant 할당 화면. 사람이 이 agent에게 앱, 외부 MCP tool, 부를 수 있는 다른 agent, 설정 고치기를 붙이고
// 대상마다 실행 때 묻는지를 정한다. 효과별 기본값을 위에 보이고, 앱은 펼치면 app-api마다 빼거나 묻는지를 바꾼다.
import { useState } from "react";
import {
  Button,
  Field,
  Icon,
  iconPixels,
  Menu,
  Select,
  Switch,
} from "@lophn/design/components";
import {
  lophnSpaceIcons,
} from "../../../../../packages/shell/renderer/icons/mod.ts";

import {
  type AgentSpec,
  APPS,
  type Ask,
  ASK_LABEL,
  CALLABLE_AGENTS,
  DEFAULT_ASK,
  DEFAULTS_TABLE,
  EFFECT_LABEL,
  GRANTS,
  type GrantTarget,
  MCP_TOOL_GRANTS,
  SETTINGS_GRANT,
} from "./setup-data.ts";
import s from "./agent-setup.module.css";

const ASK_OPTIONS = (Object.keys(ASK_LABEL) as Ask[]).map((value) => ({
  value,
  label: ASK_LABEL[value],
}));

/** 대상 하나에 사람이 정한 것. `ask`가 없으면 효과별 기본값이다. */
interface Pick {
  readonly removed: boolean;
  readonly ask?: Ask;
}

type Picks = Readonly<Record<string, Pick>>;

const initialPicks = (targets: readonly GrantTarget[]): Picks =>
  Object.fromEntries(
    targets.map((
      target,
    ) => [target.id, { removed: target.removed ?? false, ask: target.ask }]),
  );

const askOf = (target: GrantTarget, pick: Pick): Ask =>
  pick.ask ?? DEFAULT_ASK[target.effect];

const changed = (target: GrantTarget, pick: Pick) =>
  pick.ask !== undefined && pick.ask !== DEFAULT_ASK[target.effect];

/** 대상 줄 하나: 넣음/뺌 스위치, 효과, 묻는지, 상태 글. */
function GrantRow(
  { target, pick, onPick, effect = true }: {
    target: GrantTarget;
    pick: Pick;
    onPick: (pick: Pick) => void;
    /** 효과 칸을 그리나. 다른 agent 부르기와 설정 고치기는 효과가 하나뿐이라 그리지 않는다. */
    effect?: boolean;
  },
) {
  const fresh = target.addedIn !== undefined && !changed(target, pick);
  return (
    <li
      className={`${s.grantRow} ${effect ? "" : s.grantRowCall} ${
        pick.removed ? s.grantRemoved : ""
      }`}
    >
      <span className={s.grantMain}>
        <span className={s.grantName}>{target.name}</span>
        <span className={s.grantDetail}>{target.detail}</span>
      </span>
      {effect
        ? <span className={s.chip}>{EFFECT_LABEL[target.effect]}</span>
        : null}
      <span className={s.grantNote}>
        {pick.removed
          ? "Left out. This agent can't use it."
          : changed(target, pick)
          ? (
            <>
              Changed by you
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onPick({ ...pick, ask: undefined })}
              >
                Reset
              </Button>
            </>
          )
          : fresh
          ? (
            <>
              <span className={`${s.chip} ${s.chipNew}`}>
                New in {target.addedIn}
              </span>
              Came in with the default
            </>
          )
          : "Default"}
      </span>
      <span className={s.hiddenLabel}>
        <Field label={`When ${target.name} runs`}>
          <Select
            size="sm"
            options={ASK_OPTIONS}
            value={askOf(target, pick)}
            disabled={pick.removed}
            onValueChange={(value) => {
              const ask = value as Ask;
              onPick({
                ...pick,
                ask: ask === DEFAULT_ASK[target.effect] ? undefined : ask,
              });
            }}
          />
        </Field>
      </span>
      <span className={`${s.toggleCell} ${s.hiddenLabel}`}>
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
      className={`${s.grantHead} ${effect ? "" : s.grantRowCall}`}
      aria-hidden="true"
    >
      <span>Name</span>
      {effect ? <span>Effect</span> : null}
      <span>Status</span>
      <span>When it runs</span>
      <span>Allowed</span>
    </li>
  );
}

function useTargets(initial: readonly GrantTarget[]) {
  const [picks, setPicks] = useState<Picks>(initialPicks(initial));
  const set = (id: string, pick: Pick) =>
    setPicks((now) => ({ ...now, [id]: pick }));
  return { picks, set };
}

const summary = (
  targets: readonly GrantTarget[],
  picks: Picks,
  noun: string,
) => {
  const used = targets.filter((target) => !picks[target.id].removed);
  const asking =
    used.filter((target) => askOf(target, picks[target.id]) === "ask").length;
  return `${used.length} of ${targets.length} ${noun} · ${
    asking === 0 ? "none ask first" : `${asking} ask first`
  }`;
};

/** 할당한 앱 하나. 펼치면 그 앱의 app-api가 줄마다 나온다. */
function AppCard(
  { name, release, apis, open: initialOpen, onRemove }: {
    name: string;
    release: string;
    apis: readonly GrantTarget[];
    open: boolean;
    onRemove: () => void;
  },
) {
  const [open, setOpen] = useState(initialOpen);
  const { picks, set } = useTargets(apis);
  return (
    <div className={s.targetCard}>
      <div className={s.targetHead}>
        <button
          type="button"
          className={s.expand}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Icon
            icon={open ? lophnSpaceIcons.collapse : lophnSpaceIcons.expand}
            pixels={iconPixels("small")}
          />
          {name}
          <span className={s.targetSummary}>
            release {release} · {summary(apis, picks, "app-apis")}
          </span>
        </button>
        <Button size="sm" variant="ghost" onClick={onRemove}>Remove app</Button>
      </div>
      {open
        ? (
          <ul className={s.grantRows}>
            <RowHead />
            {apis.map((api) => (
              <GrantRow
                key={api.id}
                target={api}
                pick={picks[api.id]}
                onPick={(pick) => set(api.id, pick)}
              />
            ))}
          </ul>
        )
        : null}
    </div>
  );
}

/** 외부 MCP server 하나의 tool들. */
function ToolCard(
  { server, tools, onRemove }: {
    server: string;
    tools: readonly GrantTarget[];
    onRemove: () => void;
  },
) {
  const [open, setOpen] = useState(true);
  const { picks, set } = useTargets(tools);
  return (
    <div className={s.targetCard}>
      <div className={s.targetHead}>
        <button
          type="button"
          className={s.expand}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Icon
            icon={open ? lophnSpaceIcons.collapse : lophnSpaceIcons.expand}
            pixels={iconPixels("small")}
          />
          {server}
          <span className={s.targetSummary}>
            {summary(tools, picks, "tools")}
          </span>
        </button>
        <Button size="sm" variant="ghost" onClick={onRemove}>
          Remove server
        </Button>
      </div>
      {open
        ? (
          <ul className={s.grantRows}>
            <RowHead />
            {tools.map((tool) => (
              <GrantRow
                key={tool.id}
                target={tool}
                pick={picks[tool.id]}
                onPick={(pick) => set(tool.id, pick)}
              />
            ))}
          </ul>
        )
        : null}
    </div>
  );
}

/** 이름 목록 중 하나를 골라 더하는 menu 단추. 더할 것이 없으면 흐리다. */
function AssignMenu(
  { label, items, onAdd }: {
    label: string;
    items: readonly string[];
    onAdd: (name: string) => void;
  },
) {
  return (
    <Menu
      trigger={
        <Button
          size="sm"
          icon={lophnSpaceIcons.add}
          disabled={items.length === 0}
        >
          {label} ▾
        </Button>
      }
      items={items.map((name) => ({ id: name, label: name }))}
      onSelect={onAdd}
    />
  );
}

/** 효과별 기본값 표. 묻는지의 시작 값이고 대상마다 바꿀 수 있다. */
export function DefaultsTable() {
  return (
    <div className={s.defaults} role="table" aria-label="Defaults by effect">
      {DEFAULTS_TABLE.map((row) => (
        <div key={row.effect} className={s.contents} role="row">
          <span className={s.chip} role="cell">
            {EFFECT_LABEL[row.effect]}
          </span>
          <span className={s.defaultsAsk} role="cell">
            {ASK_LABEL[DEFAULT_ASK[row.effect]]}
          </span>
          <span className={s.defaultsMeaning} role="cell">
            {row.meaning}
          </span>
        </div>
      ))}
    </div>
  );
}

export interface GrantsPanelProps {
  readonly agent: AgentSpec;
  /** 처음부터 펼쳐 둘 앱 이름. */
  readonly openApp?: string;
}

/** 이 agent에게 붙인 것과 묻는지. 붙은 것은 agent마다 다르다. */
export function GrantsPanel({ agent, openApp }: GrantsPanelProps) {
  const start = GRANTS[agent.id] ??
    { apps: [], tools: [], agents: [], settings: false };
  const [apps, setApps] = useState<readonly string[]>(start.apps);
  const [servers, setServers] = useState<readonly string[]>(start.tools);
  const [callable, setCallable] = useState<readonly string[]>(start.agents);
  const callableTargets = CALLABLE_AGENTS.filter((item) =>
    item.id !== agent.id
  );
  const calls = useTargets(callableTargets);
  const settings = useTargets([{
    ...SETTINGS_GRANT,
    removed: !start.settings,
  }]);
  return (
    <div className={s.grants}>
      <section>
        <p className={s.sectionLead}>
          What {agent.name}{" "}
          can use besides its own tools. Each item says whether it asks you
          first. Anything you don't add here, {agent.name} can't use.
        </p>
        <DefaultsTable />
        <p className={s.note}>
          These are the starting values. You can change any app-api or tool
          below. A new release's app-apis start with the default again; what you
          changed stays.
        </p>
      </section>

      <section>
        <div className={s.sectionHead}>
          <h2 className={s.sectionTitle}>Apps</h2>
          <AssignMenu
            label="Assign app"
            items={APPS.filter((app) => !apps.includes(app.app)).map((app) =>
              app.app
            )}
            onAdd={(name) => setApps([...apps, name])}
          />
        </div>
        {apps.length === 0
          ? (
            <p className={s.empty}>
              No apps. An assigned app brings all of its app-apis.
            </p>
          )
          : APPS.filter((app) => apps.includes(app.app)).map((app) => (
            <AppCard
              key={app.app}
              name={app.app}
              release={app.release}
              apis={app.apis}
              open={app.app === openApp}
              onRemove={() => setApps(apps.filter((name) => name !== app.app))}
            />
          ))}
      </section>

      <section>
        <div className={s.sectionHead}>
          <h2 className={s.sectionTitle}>Tools from MCP servers</h2>
          <AssignMenu
            label="Assign tools"
            items={MCP_TOOL_GRANTS.filter((group) =>
              !servers.includes(group.server)
            ).map((group) => group.server)}
            onAdd={(name) => setServers([...servers, name])}
          />
        </div>
        {servers.length === 0
          ? <p className={s.empty}>No MCP tools.</p>
          : MCP_TOOL_GRANTS.filter((group) => servers.includes(group.server))
            .map((group) => (
              <ToolCard
                key={group.server}
                server={group.server}
                tools={group.tools}
                onRemove={() =>
                  setServers(servers.filter((name) => name !== group.server))}
              />
            ))}
        <p className={s.note}>
          A tool counts as Read when its server says it only reads, otherwise as
          External.
        </p>
      </section>

      <section>
        <div className={s.sectionHead}>
          <h2 className={s.sectionTitle}>Agents it can call</h2>
          <AssignMenu
            label="Add agent"
            items={callableTargets.filter((item) => !callable.includes(item.id))
              .map((item) => item.name)}
            onAdd={(name) => {
              const found = callableTargets.find((item) => item.name === name);
              if (found) setCallable([...callable, found.id]);
            }}
          />
        </div>
        {callable.length === 0
          ? <p className={s.empty}>It can't hand tasks to other agents.</p>
          : (
            <ul className={`${s.grantRows} ${s.standalone}`}>
              <RowHead effect={false} />
              {callableTargets.filter((item) => callable.includes(item.id))
                .map((item) => (
                  <GrantRow
                    key={item.id}
                    target={item}
                    effect={false}
                    pick={calls.picks[item.id]}
                    onPick={(pick) => calls.set(item.id, pick)}
                  />
                ))}
            </ul>
          )}
      </section>

      <section>
        <div className={s.sectionHead}>
          <h2 className={s.sectionTitle}>Change settings</h2>
        </div>
        <ul className={`${s.grantRows} ${s.standalone}`}>
          <GrantRow
            target={SETTINGS_GRANT}
            effect={false}
            pick={settings.picks[SETTINGS_GRANT.id]}
            onPick={(pick) => settings.set(SETTINGS_GRANT.id, pick)}
          />
        </ul>
        <p className={s.note}>
          It asks first by default, so an agent can't widen its own grants.
        </p>
      </section>
    </div>
  );
}
