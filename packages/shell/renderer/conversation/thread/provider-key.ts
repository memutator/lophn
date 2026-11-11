// provider 오류 줄의 [Enter key]가 하는 일. 이 session의 model이 속한 provider를 알면 Settings › Providers가
// 연결된 provider의 key를 넣을 때 여는 것과 같은 보호 입력 창을 열고(저장 길은 창이 한다), 모르면 Settings › Providers로 간다.
import type { AcpSessionMeta } from "../../../../protocol/acp/mod.ts";
import {
  enterSecret,
  providerSecretName,
  windowSecretInputOpener,
} from "../../desktop/settings/core-call.ts";

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

export function providerKeyFix(
  provider: { id: string; name: string } | null,
  openConnections: (() => void) | undefined,
): ProviderKeyFix | undefined {
  if (provider === null) {
    return openConnections === undefined
      ? undefined
      : { name: null, run: openConnections };
  }
  return {
    name: provider.name,
    run: () =>
      void enterSecret(windowSecretInputOpener(), {
        name: providerSecretName(provider.id),
        purpose: "provider",
        subject: provider.name,
      }),
  };
}
