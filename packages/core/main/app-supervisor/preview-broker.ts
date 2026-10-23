// preview 자식의 broker 서비스 조립. 외부에 닿는 서비스(net·secret)는 모두 대역이다. 선언은 그 bundle의
// 고정 blueprint가 정하고 grant는 없다. 운영 자식의 broker와 hub를 나눠서 한 앱의 운영 정지·회수가
// preview의 연결을 막지 않고 그 반대도 같다.
import {
  type BrokerServices,
  createReadyService,
} from "../../apps/permissions/mod.ts";
import {
  createPreviewBrokerServices,
  type PreviewScope,
  previewScopeOf,
} from "../../apps/preview/mod.ts";

// 선언을 읽지 못하면 아무 외부도 허락하지 않는다(대역도 선언 안에서만 받는다).
const CLOSED_SCOPE: PreviewScope = { secrets: [], net: [] };

// preview의 disposable 영역은 `<data root>/apps/<app>/preview/<nonce>`이고 고정 bundle 사본은
// `<data root>/apps/<app>/bundles/<bundle hash>/`다(apps/releases bundle 사본 위치 규칙).
export async function previewScopeFromBundle(info: {
  app: string;
  bundleHash: string;
  dataPath: string;
}): Promise<PreviewScope> {
  const marker = `/apps/${info.app}/preview/`;
  const at = info.dataPath.indexOf(marker);
  if (at < 0) return CLOSED_SCOPE;
  const root = info.dataPath.slice(0, at);
  try {
    const text = await Deno.readTextFile(
      `${root}/apps/${info.app}/bundles/${info.bundleHash}/declaration.json`,
    );
    const blueprint = JSON.parse(text) as { permissions?: unknown };
    if (!Array.isArray(blueprint.permissions)) return CLOSED_SCOPE;
    return previewScopeOf(
      blueprint as Parameters<typeof previewScopeOf>[0],
    );
  } catch {
    return CLOSED_SCOPE;
  }
}

export function previewServicesFor(scope: PreviewScope): BrokerServices {
  const built = createPreviewBrokerServices({ scope });
  // preview의 DB는 일회용이라 시작 changeset을 어디에도 남기지 않는다. 알림만 받는다.
  return {
    ...built.services,
    ready: createReadyService({ receiver: { ready: () => {} } }),
  };
}
