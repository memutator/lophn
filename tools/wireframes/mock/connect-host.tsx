// 제품 Desktop이 화면 전체를 감싸는 ConnectProviderHost를 gallery 화면도 같이 쓴다. 감싸지 않으면 model picker의
// Connect provider 줄이 숨는다. 화면이 provider·기본 model 상태를 정했으면 그 source를 넘기고, 아니면 기본 fake다.
import { type ReactNode, useMemo } from "react";

import { ConnectProviderHost } from "../../../packages/shell/renderer/desktop/settings/providers/connect-host.tsx";
import type { AgentsSettingsSource } from "../../../packages/shell/renderer/desktop/settings/agents/settings-source.ts";
import type { ProviderSettingsSource } from "../../../packages/shell/renderer/desktop/settings/providers/settings-source.ts";
import { fakeAgents } from "../../../packages/shell/renderer/desktop/settings/agents/testdata/fake-agents.ts";
import { fakeProviders } from "../../../packages/shell/renderer/desktop/settings/providers/testdata/fake-providers.ts";

export function GalleryConnectHost(
  { providers, agents, children }: {
    providers?: ProviderSettingsSource;
    agents?: AgentsSettingsSource;
    children: ReactNode;
  },
) {
  const fallback = useMemo(() => ({
    providers: fakeProviders().source,
    agents: fakeAgents().source,
  }), []);
  return (
    <ConnectProviderHost
      providers={providers ?? fallback.providers}
      agents={agents ?? fallback.agents}
    >
      {children}
    </ConnectProviderHost>
  );
}
