// provider 오류 줄의 [Enter key]가 하는 일. 이 session의 model이 속한 provider를 알면 Settings › Providers가
// 연결된 provider의 key를 넣을 때 여는 것과 같은 보호 입력 창을 열고(저장 길은 창이 한다), 모르면 Settings › Providers로 간다.
// 보호 입력 창이 없는 창도 Settings로 가는 길뿐이다.
import { useEffect, useState } from "react";

import type { AcpSessionMeta } from "../../../../protocol/acp/mod.ts";
import type { AgentTabSource } from "../agent-tab-source.ts";

export interface ProviderKeyFix {
  /** 창이 key를 받을 provider의 이름. null이면 provider를 모르고 Settings › Providers로 간다. */
  readonly name: string | null;
  readonly run: () => void;
}

/** model id는 `<provider id>/<model name>`이고 그 provider가 연결된 provider 묶음에 있을 때만 안다. */
export function providerOfModel(
  meta: Pick<AcpSessionMeta, "model" | "models"> | null,
): { id: string; name: string } | null {
  const id = meta?.model?.model.split("/", 1)[0];
  const group = meta?.models.find((one) => one.id === id);
  return group === undefined ? null : { id: group.id, name: group.label };
}

/**
 * provider의 인증 방식. 아직 읽지 못했거나 읽을 수 없으면 null이다. provider가 바뀌면 다시 읽는다.
 */
export function useProviderAuthKind(
  source: Pick<AgentTabSource, "providerAuthKind">,
  provider: string | null,
): string | null {
  const [read, setRead] = useState<{ provider: string; kind: string } | null>(
    null,
  );
  useEffect(() => {
    if (provider === null || source.providerAuthKind === undefined) return;
    let live = true;
    void source.providerAuthKind(provider).then((result) => {
      if (live && result.ok) setRead({ provider, kind: result.value });
    });
    return () => {
      live = false;
    };
  }, [source, provider]);
  return read !== null && read.provider === provider ? read.kind : null;
}

/** key 창은 API key로 연결된 provider에만 연다. 구독(OAuth) provider의 secret은 token이라 key를 넣으면 연결이 깨진다. */
export function providerKeyFix(
  provider: { id: string; name: string } | null,
  authKind: string | null,
  openConnections: (() => void) | undefined,
  enterKey: ((provider: { id: string; name: string }) => void) | undefined,
): ProviderKeyFix | undefined {
  if (provider === null || authKind !== "api_key" || enterKey === undefined) {
    return openConnections === undefined
      ? undefined
      : { name: null, run: openConnections };
  }
  return { name: provider.name, run: () => enterKey(provider) };
}
