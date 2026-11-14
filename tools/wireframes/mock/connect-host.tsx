// 제품 Desktop이 화면 전체를 감싸는 ConnectProviderHost를 gallery 화면도 같이 쓴다. 감싸지 않으면 model picker의
// Manage models 줄이 숨는다. 화면이 provider·기본 model 상태를 정했으면 그 source를 넘기고, 아니면 기본 fake다.
// 연결 창의 목록은 useCoreRead로 읽으므로 event 연결이 없는 화면(대화 page)이면 기본 fake의 가짜 core를 끼운다.
import { type ReactNode, useMemo } from "react";

import { createEventClient } from "../../../packages/shell/renderer/desktop/connection/events/client.ts";
import { createFakeSource } from "../../../packages/shell/renderer/desktop/connection/events/fake-source.ts";
import {
  EventsProvider,
  useOptionalEventClient,
} from "../../../packages/shell/renderer/desktop/connection/events/hooks.tsx";
import { ConnectProviderHost } from "../../../packages/shell/renderer/desktop/settings/providers/connect-host.tsx";
import type { AgentsSettingsSource } from "../../../packages/shell/renderer/desktop/settings/agents/settings-source.ts";
import type { ProviderSettingsSource } from "../../../packages/shell/renderer/desktop/settings/providers/settings-source.ts";
import { fakeAgents } from "../../../packages/shell/renderer/desktop/settings/agents/testdata/fake-agents.ts";
import { fakeProviders } from "../../../packages/shell/renderer/desktop/settings/providers/testdata/fake-providers.ts";
import { fakeCore } from "../../../packages/shell/renderer/desktop/settings/testdata/fake-core.ts";
import { CUSTOM_PROVIDER } from "../../../packages/shell/renderer/workspace/agents/fake-source.ts";

export function GalleryConnectHost({
  providers,
  agents,
  children,
}: {
  providers?: ProviderSettingsSource;
  agents?: AgentsSettingsSource;
  children: ReactNode;
}) {
  const outer = useOptionalEventClient();
  const fallback = useMemo(() => {
    const core = fakeCore();
    const made = {
      providers: fakeProviders({ core, customId: CUSTOM_PROVIDER }).source,
      agents: fakeAgents({ core }).source,
    };
    const source = createFakeSource({
      snapshots: [],
      consents: [],
      answers: core.answers,
    });
    core.attach(source);
    return { ...made, client: createEventClient(source) };
  }, []);
  const host = (
    <ConnectProviderHost
      providers={providers ?? fallback.providers}
      agents={agents ?? fallback.agents}
    >
      {children}
    </ConnectProviderHost>
  );
  return outer === null ? (
    <EventsProvider client={fallback.client}>{host}</EventsProvider>
  ) : (
    host
  );
}
