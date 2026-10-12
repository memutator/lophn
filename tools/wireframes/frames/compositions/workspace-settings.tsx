// Lophn Workspace › Settings. 세로 nav(General · Providers · Agents · Coding agents · Notifications · Update
// lophn · Diagnose)와 새로 그리는 두 화면: Providers(계정과 인증만)와 Agents(모든 project의 기본값).
// 표는 칸에 단추가 있어야 해서 design Table의 CSS Module로 짠 look-alike이고, provider 연결 창의 정적 모양
// (A9b)은 한 화면에 두 창을 나란히 놓으려고 같은 token으로 짠 look-alike다. 눌러서 여는 창은 실제 Dialog다.
import type { ReactNode } from "react";
import {
  Button,
  Dialog,
  Field,
  Input,
  lophnSpaceIcons,
  Select,
} from "@lophn/design/components";

import tableStyles from "../../../../packages/design/components/table/table.module.css";
import {
  GLOBAL_LOPHN_MD_PREVIEW,
  GLOBAL_MCP,
  GLOBAL_SKILLS,
  ROLE_MODELS,
} from "./agents-data.ts";
import { selectionLabel } from "./model-options.ts";
import { ToggleList } from "./agents-tab.tsx";
import styles from "./compose.module.css";
import a from "./agents.module.css";

export type SettingsPane =
  | "general"
  | "providers"
  | "agents"
  | "coding"
  | "notifications"
  | "update"
  | "diagnose";

const NAV: readonly { id: SettingsPane; label: string }[] = [
  { id: "general", label: "General" },
  { id: "providers", label: "Providers" },
  { id: "agents", label: "Agents" },
  { id: "coding", label: "Coding agents" },
  { id: "notifications", label: "Notifications" },
  { id: "update", label: "Update lophn" },
  { id: "diagnose", label: "Diagnose" },
];

const CONNECTED: readonly { name: string; how: string }[] = [
  { name: "Anthropic", how: "Signed in (Max)" },
  { name: "OpenAI", how: "API key" },
  { name: "xAI", how: "API key" },
];

const AVAILABLE: readonly { name: string; hint: string }[] = [
  { name: "Google", hint: "Gemini models" },
  { name: "OpenRouter", hint: "Models from many providers" },
  { name: "Custom provider", hint: "Any OpenAI-compatible endpoint" },
];

/** 연결 창의 고르기 목록. */
function Methods({ provider }: { provider: string }) {
  const methods = provider === "OpenAI"
    ? [
      { name: "Sign in with ChatGPT", hint: "Opens your browser" },
      { name: "API key", hint: "Paste a key" },
    ]
    : provider === "Anthropic"
    ? [
      { name: "Sign in with Claude", hint: "Opens your browser" },
      { name: "API key", hint: "Paste a key" },
    ]
    : [{ name: "API key", hint: "Paste a key" }];
  return (
    <>
      <p className={a.panelLead}>How do you want to sign in to {provider}?</p>
      <ul className={a.methods}>
        {methods.map((method) => (
          <li key={method.name}>
            <button type="button" className={a.method}>
              <span>{method.name}</span>
              <span className={a.methodHint}>{method.hint}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Custom provider form. */
function CustomProviderForm() {
  return (
    <div className={a.formStack}>
      <p className={a.panelLead}>Set up an OpenAI-compatible provider.</p>
      <Field
        label="Provider ID"
        help="Lowercase letters, numbers, hyphens or underscores."
      >
        <Input defaultValue="myprovider" />
      </Field>
      <Field label="Display name">
        <Input defaultValue="My AI provider" />
      </Field>
      <Field label="Base URL">
        <Input defaultValue="https://api.myprovider.com/v1" />
      </Field>
      <Field
        label="API key (optional)"
        help="Leave it empty if you manage sign-in through headers."
      >
        <Input type="password" />
      </Field>
    </div>
  );
}

/** A9b: 연결 창 둘을 나란히. 한쪽은 방법 고르기, 한쪽은 Custom provider form. */
export function ConnectDialogsStatic() {
  return (
    <div className={a.dialogLayer}>
      <div className={a.panel} role="dialog" aria-label="Connect OpenAI">
        <h2 className={a.panelTitle}>Connect OpenAI</h2>
        <Methods provider="OpenAI" />
        <div className={a.panelActions}>
          <Button>Cancel</Button>
        </div>
      </div>
      <div
        className={`${a.panel} ${a.panelWide}`}
        role="dialog"
        aria-label="Custom provider"
      >
        <h2 className={a.panelTitle}>Custom provider</h2>
        <CustomProviderForm />
        <div className={a.panelActions}>
          <Button>Cancel</Button>
          <Button variant="primary">Connect</Button>
        </div>
      </div>
    </div>
  );
}

function ProviderRow(
  { name, badge, hint, action }: {
    name: string;
    badge?: string;
    hint?: string;
    action: ReactNode;
  },
) {
  return (
    <li className={a.provRow}>
      <span className={a.provName}>
        {name}
        {badge === undefined ? null : <span className={a.badge}>{badge}</span>}
        {hint === undefined ? null : <span className={a.provHint}>{hint}</span>}
      </span>
      {action}
    </li>
  );
}

/** A9: Settings › Providers. 연결과 인증만이고 model은 여기서 고르지 않는다. */
export function ProvidersPane(
  { onConnect }: { onConnect: (provider: string) => void },
) {
  return (
    <div className={a.setPage}>
      <h1 className={styles.searchTitle}>Providers</h1>
      <p className={a.setLead}>
        A provider is a service you connect with one key or sign-in. You choose
        models per agent and per session, not here.
      </p>
      <section>
        <h2 className={a.setSectionTitle}>Connected</h2>
        <ul className={a.provGroup}>
          {CONNECTED.map((provider) => (
            <ProviderRow
              key={provider.name}
              name={provider.name}
              badge={provider.how}
              action={<Button size="sm">Disconnect</Button>}
            />
          ))}
        </ul>
      </section>
      <section className={a.setSection}>
        <h2 className={a.setSectionTitle}>Add a provider</h2>
        <ul className={a.provGroup}>
          {AVAILABLE.map((provider) => (
            <ProviderRow
              key={provider.name}
              name={provider.name}
              hint={provider.hint}
              action={
                <Button
                  size="sm"
                  icon={lophnSpaceIcons.add}
                  onClick={() => onConnect(provider.name)}
                >
                  Connect
                </Button>
              }
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

/** 눌러서 여는 연결 창. 실제 Dialog다. */
export function ConnectDialog(
  { provider, onClose }: { provider: string | null; onClose: () => void },
) {
  const custom = provider === "Custom provider";
  return (
    <Dialog
      open={provider !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={custom ? "Custom provider" : `Connect ${provider ?? ""}`}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {custom
            ? <Button variant="primary" onClick={onClose}>Connect</Button>
            : null}
        </>
      }
    >
      {provider === null
        ? null
        : custom
        ? <CustomProviderForm />
        : <Methods provider={provider} />}
    </Dialog>
  );
}

/** A10: Settings › Agents. 모든 project에 적용되는 기본값. */
export function AgentsPane() {
  return (
    <div className={a.setPage}>
      <h1 className={styles.searchTitle}>Agents</h1>
      <p className={a.setLead}>
        Defaults for every project. A project can change them in its Agents tab.
      </p>
      <section>
        <h2 className={a.setSectionTitle}>Default models</h2>
        <p className={a.setLead}>
          Model and its options per role. A project or an Operator can change
          them.
        </p>
        <div className={tableStyles.scroller}>
          <table className={tableStyles.table} data-density="comfortable">
            <thead>
              <tr>
                {["Agent", "Model", ""].map((header, index) => (
                  <th
                    key={index}
                    scope="col"
                    className={tableStyles.head}
                    aria-label={header === "" ? "Actions" : undefined}
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROLE_MODELS.map((row) => (
                <tr key={row.role} className={tableStyles.row}>
                  <td className={tableStyles.text}>{row.role}</td>
                  <td className={tableStyles.text}>
                    {selectionLabel(row.workspace)}
                  </td>
                  <td className={tableStyles.text}>
                    <Button size="sm">Change</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className={a.setSection}>
        <div className={a.sectionHead}>
          <h2 className={a.setSectionTitle}>Instructions for all projects</h2>
          <Button size="sm">Edit</Button>
        </div>
        <p className={a.setLead}>
          <span className={styles.mono}>~/.lophn/LOPHN.md</span>
        </p>
        <pre className={styles.code}>{GLOBAL_LOPHN_MD_PREVIEW}</pre>
      </section>
      <section className={a.setSection}>
        <div className={a.sectionHead}>
          <h2 className={a.setSectionTitle}>Skills (all projects)</h2>
          <Button size="sm" icon={lophnSpaceIcons.add}>Add skill</Button>
        </div>
        <ToggleList items={GLOBAL_SKILLS} />
        <p className={styles.note}>
          Skill folders follow the Agent Skills format (SKILL.md).
        </p>
      </section>
      <section className={a.setSection}>
        <div className={a.sectionHead}>
          <h2 className={a.setSectionTitle}>MCP servers (all projects)</h2>
          <Button size="sm" icon={lophnSpaceIcons.add}>Add server</Button>
        </div>
        <ToggleList items={GLOBAL_MCP} />
        <p className={styles.note}>Import from .mcp.json</p>
      </section>
      <section className={a.setSection}>
        <h2 className={a.setSectionTitle}>Permissions default</h2>
        <div className={styles.form}>
          <Field label="New agents start with">
            <Select
              options={[
                { value: "ask", label: "Ask first" },
                { value: "edits", label: "Allow document edits" },
              ]}
              defaultValue="ask"
            />
          </Field>
        </div>
      </section>
    </div>
  );
}

/** Settings의 다른 항목. 이 wireframe에서는 바뀌지 않는다. */
function UnchangedPane({ label }: { label: string }) {
  return (
    <div className={a.setPage}>
      <h1 className={styles.searchTitle}>{label}</h1>
      <p className={a.setLead}>
        Not part of this wireframe. Nothing changes here.
      </p>
    </div>
  );
}

/** Settings 화면: 왼쪽 세로 nav와 고른 항목. */
export function SettingsScreen(
  { pane, onPane, onConnect }: {
    pane: SettingsPane;
    onPane: (pane: SettingsPane) => void;
    onConnect: (provider: string) => void;
  },
) {
  return (
    <div className={a.settings}>
      <nav className={a.setNav} aria-label="Settings">
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            className={a.setNavItem}
            aria-current={item.id === pane ? "page" : undefined}
            onClick={() => onPane(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className={a.setBody}>
        {pane === "providers"
          ? <ProvidersPane onConnect={onConnect} />
          : pane === "agents"
          ? <AgentsPane />
          : (
            <UnchangedPane
              label={NAV.find((item) => item.id === pane)?.label ?? ""}
            />
          )}
      </div>
    </div>
  );
}
