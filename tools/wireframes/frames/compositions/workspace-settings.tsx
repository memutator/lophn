// Lophn Workspace › Settings의 Providers(provider마다 연결 하나)와 Agents(모든 project의
// 기본값, 화면은 agent-setup/) 본문. 연결 창의 정적 모양은 한 화면에 두 창을 나란히 놓으려고 같은 token으로 짠
// look-alike이고, 눌러서 여는 창은 실제 Dialog다. key는 이 창에서 치지 않고 보호 입력으로 받는다.
import { type ReactNode, useState } from "react";
import {
  Button,
  Dialog,
  Field,
  Input,
  VendorIcon,
  vendorOf,
} from "@lophn/design/components";
import {
  lophnSpaceIcons,
} from "../../../../packages/shell/renderer/icons/mod.ts";

import { ProtectedKeyNote } from "./agent-setup/parts.tsx";
import {
  SettingsAgents,
  SettingsLophn,
} from "./agent-setup/settings-agents.tsx";
import styles from "./compose.module.css";
import a from "./agents.module.css";

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

/** provider 이름과 vendor 아이콘. 아이콘이 없는 이름(Custom provider)은 이름만 쓴다. */
function ProviderName({ name }: { name: string }) {
  const vendor = vendorOf(name);
  return (
    <span className={a.provName}>
      {vendor === undefined ? null : <VendorIcon vendor={vendor} size={18} />}
      {name}
    </span>
  );
}

/** 연결 창의 고르기 목록. */
function Methods({ provider }: { provider: string }) {
  const methods = provider === "OpenAI"
    ? [
      { name: "Sign in with ChatGPT", hint: "Opens your browser" },
      { name: "API key", hint: "Typed in a protected prompt" },
    ]
    : provider === "Anthropic"
    ? [
      { name: "Sign in with Claude", hint: "Opens your browser" },
      { name: "API key", hint: "Typed in a protected prompt" },
    ]
    : [{ name: "API key", hint: "Typed in a protected prompt" }];
  return (
    <>
      <ProviderName name={provider} />
      <p className={a.panelLead}>How do you want to sign in?</p>
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
      <ProtectedKeyNote
        title="API key (optional)"
        text="Typed in a protected prompt after you connect, outside this window. Skip it if you manage sign-in through headers."
      />
    </div>
  );
}

/** 연결 창 둘을 나란히. 한쪽은 방법 고르기, 한쪽은 Custom provider form. */
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
        {vendorOf(name) === undefined
          ? null
          : <VendorIcon vendor={vendorOf(name)!} size={18} />}
        {name}
        {badge === undefined ? null : <span className={a.badge}>{badge}</span>}
        {hint === undefined ? null : <span className={a.provHint}>{hint}</span>}
      </span>
      {action}
    </li>
  );
}

/** Settings › Providers. 연결과 인증만이고 model은 여기서 고르지 않는다. */
export function ProvidersPane(
  { onConnect }: { onConnect: (provider: string) => void },
) {
  return (
    <div className={a.setPage}>
      <h1 className={styles.searchTitle}>Providers</h1>
      <p className={a.setLead}>
        A provider is a service you connect once, with one key or sign-in. You
        choose models per agent and per session, not here.
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

/** Settings › Agents. 모든 project에 적용되는 기본값. lophn의 설정은 이 안의 둘째 화면이다. */
export function AgentsPane(
  { initialView = "list" }: { initialView?: "list" | "lophn" } = {},
) {
  const [view, setView] = useState(initialView);
  return view === "lophn"
    ? <SettingsLophn onBack={() => setView("list")} />
    : <SettingsAgents onOpenLophn={() => setView("lophn")} />;
}
