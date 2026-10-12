// preview 자식의 broker 서비스 조립. 외부에 닿는 서비스(net·secret·문서·다른 앱)는
// 모두 대역이고, 기록(invocation)만 운영과 같은 전달 목록으로 가되 mode로 구별된다. 선언은 그 bundle의
// 고정 blueprint가 정하고 grant는 없다. 운영 자식의 broker와 hub를 나눠서 한 앱의 운영 정지·회수가
// preview의 연결을 막지 않고 그 반대도 같다.
import { err, ok } from "../../../base/mod.ts";
import {
  type AppsConnectService,
  type BrokerAccess,
  type BrokerServices,
  createProblemReportService,
  type InvocationBroker,
  type ProblemsReport,
} from "../../apps/permissions/mod.ts";
import {
  createPreviewBrokerServices,
  type PreviewScope,
  previewScopeOf,
} from "../../apps/preview/mod.ts";

// 선언을 읽지 못하면 아무 외부도 허락하지 않는다(대역도 선언 안에서만 받는다).
const CLOSED_SCOPE: PreviewScope = { secrets: [], net: [], documents: [] };

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
      `${root}/apps/${info.app}/bundles/${info.bundleHash}/blueprint.json`,
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

// preview의 보고는 개발 진단이고 운영 problem을 열거나 닫지 않는다. 진단 전달 길(preview 전용
// credential)이 아직 없어서 전달하지 않고 이유를 낸다. 성공을 꾸미지 않는다.
const closedProblems: ProblemsReport = {
  report: () =>
    Promise.resolve(err({
      code: "unavailable",
      message: "preview diagnostics are not connected",
    })),
};
// preview 자식에는 현재 release 선언이 없다. 보고 service가 선언 code 검사 대신 collector에 맡기는 자식은
// release가 없는 자식이고, release가 있는 preview는 선언을 모르는 것으로 닫는다.
const noAccess: BrokerAccess = { current: () => Promise.resolve(ok(null)) };

export function previewServicesFor(
  scope: PreviewScope,
  invocations: Pick<InvocationBroker, "submit">,
): BrokerServices {
  const built = createPreviewBrokerServices({
    scope,
    invocations,
    problems: createProblemReportService({
      access: noAccess,
      problems: closedProblems,
    }),
  });
  return { ...built.services, apps: built.apps as AppsConnectService };
}
