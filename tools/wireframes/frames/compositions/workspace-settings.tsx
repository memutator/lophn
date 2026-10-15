// Lophn Workspace › Settings의 Providers(provider마다 연결 하나), Agents(모든 project의 기본값), Tools and skills 본문.
// 화면은 renderer의 settings/{providers,agents,extensions}가 그리고 여기서는 fake source에 이어 준다. 눌러서 여는 연결 창은 실제
// Dialog이고, 한 화면에 두 창을 나란히 놓는 ConnectDialogsStatic만 같은 body component를 div로 감싼다. key는 이 창에서 치지 않고
// 보호 입력으로 받는다.
import { type ReactNode, useMemo, useRef } from "react";
import { Button } from "@lophn/design/components";
import { t } from "@lophn/wording";

import { AgentsPanel } from "../../../../packages/shell/renderer/desktop/lophn-space/settings/agents/agents-panel.tsx";
import { fakeAgents } from "../../../../packages/shell/renderer/desktop/lophn-space/settings/agents/testdata/fake-agents.ts";
import { ExtensionsPanel } from "../../../../packages/shell/renderer/desktop/lophn-space/settings/extensions/extensions-panel.tsx";
import {
  ConnectDialog as ProviderConnectDialog,
  CustomProviderBody,
  MethodsBody,
} from "../../../../packages/shell/renderer/desktop/lophn-space/settings/providers/connect-dialog.tsx";
import { ProviderList } from "../../../../packages/shell/renderer/desktop/lophn-space/settings/providers/provider-list.tsx";
import {
  ANTHROPIC_DEFINITION,
  AVAILABLE,
  fakeProviders,
  OPENAI_DEFINITION,
  XAI_DEFINITION,
} from "../../../../packages/shell/renderer/desktop/lophn-space/settings/providers/testdata/fake-providers.ts";
import { byText, type Step, useDrive } from "./agent-setup/drive.ts";
import a from "./agents.module.css";

/** 마운트된 뒤 steps를 눌러 하위 상태를 고정한다. global이면 portal로 열린 Dialog 안도 찾는다. */
export function Driven(
  { steps, global = false, children }: {
    steps: readonly Step[];
    global?: boolean;
    children: ReactNode;
  },
) {
  const div = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLElement | null>(
    typeof document === "undefined" ? null : document.body,
  );
  useDrive(global ? body : div, steps);
  return global ? <>{children}</> : <div ref={div}>{children}</div>;
}

/** 연결 창 둘을 나란히. 한쪽은 방법 고르기, 한쪽은 Custom provider form. */
export function ConnectDialogsStatic() {
  return (
    <div className={a.dialogLayer}>
      <div
        className={a.panel}
        role="dialog"
        aria-label={t("settings.title.connect-provider", { name: "OpenAI" })}
      >
        <h2 className={a.panelTitle}>
          {t("settings.title.connect-provider", { name: "OpenAI" })}
        </h2>
        <MethodsBody definition={OPENAI_DEFINITION} />
        <div className={a.panelActions}>
          <Button>{t("settings.button.cancel")}</Button>
        </div>
      </div>
      <div
        className={`${a.panel} ${a.panelWide}`}
        role="dialog"
        aria-label={t("settings.title.custom-provider")}
      >
        <h2 className={a.panelTitle}>{t("settings.title.custom-provider")}</h2>
        <CustomProviderBody
          fields={{
            id: "myprovider",
            name: "My AI provider",
            baseUrl: "https://api.myprovider.com/v1",
          }}
        />
        <div className={a.panelActions}>
          <Button>{t("settings.button.cancel")}</Button>
          <Button variant="primary">{t("settings.button.connect")}</Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Settings › Providers. 연결과 인증만이고 model은 여기서 고르지 않는다. [Connect]가 여는 연결 창과 [Disconnect]의
 * 확인 창은 ProviderList 안의 Dialog다.
 */
export function ProvidersPane(
  _props: { onConnect?: (provider: string) => void },
) {
  const source = useMemo(() => fakeProviders().source, []);
  return <ProviderList source={source} />;
}

const DEFINITIONS = [
  ANTHROPIC_DEFINITION,
  OPENAI_DEFINITION,
  XAI_DEFINITION,
  ...AVAILABLE,
];

/** 이름으로 연 연결 창. renderer의 실제 Dialog를 얇게 감싼다. */
export function ConnectDialog(
  { provider, onClose }: { provider: string | null; onClose: () => void },
) {
  const source = useMemo(() => fakeProviders().source, []);
  return (
    <ProviderConnectDialog
      source={source}
      definition={DEFINITIONS.find((one) => one.name === provider) ?? null}
      onClose={onClose}
      onConnected={() => {}}
    />
  );
}

/** Settings › Agents. 모든 project에 적용되는 기본값. lophn의 설정은 이 안의 둘째 화면이다. */
export function AgentsPane(
  { initialView = "list" }: { initialView?: "list" | "lophn" } = {},
) {
  const source = useMemo(() => fakeAgents().source, []);
  return (
    <Driven
      steps={initialView === "lophn"
        ? [byText("button", t("agents.button.settings-open-lophn"))]
        : []}
    >
      <AgentsPanel source={source} />
    </Driven>
  );
}

/** Settings › Tools and skills. 전역 층의 skill 켬·끔과 MCP server. */
export function ToolsPane() {
  const source = useMemo(() => fakeAgents().source, []);
  return <ExtensionsPanel source={source} />;
}
