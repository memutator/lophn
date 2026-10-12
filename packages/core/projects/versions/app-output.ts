// 앱 출력 저장 범위(documents/versions#R14, apps/blueprint#R13). 앱은 자기 앱 place에만 새
// 문서를 만들고 새 판을 더한다. 어느 (앱 자리, 출력 이름)이 선언된 출력인지는 broker가 선언과
// grant로 이미 확인했고(apps/permissions#R13), 여기서는 요청 자격의 app id와 문서 자리만 본다.
import { err, type Result } from "../../../base/mod.ts";
import { appRegistrationLookup } from "../../../protocol/apps/mod.ts";
import type {
  Document,
  PreparedVersion,
} from "../../../protocol/projects/mod.ts";
import type { RequestContext, Tx } from "../../../protocol/platform/mod.ts";
import { actingApp, isAppPlace } from "../addressing/mod.ts";

function rejected(code: string, message: string): Result<never> {
  return err({ code: code as "forbidden", message });
}

// 문서가 없을 때 저장 command가 주는 답과 같다: 기준 판이 있거나 metadata가 없으면
// 새 문서 입력이 아니다. 다른 place의 기존 문서는 없는 문서와 똑같이 답해 존재를 새지 않는다.
// 기준 판 없이 metadata를 갖춘 새 문서 입력은 없는 문서라면 만들어졌을 입력이라 forbidden이다.
function absentAnswer(prepared: PreparedVersion): Result<never> {
  return prepared.base_version !== null || prepared.metadata === undefined
    ? rejected("invalid_input", "new document needs metadata")
    : rejected("forbidden", "app writes only its own app place");
}

// 앱 자격의 `document.save` 검사. 앱이 아니면 undefined(검사 없음)다.
// document는 저장 대상으로 이미 있는 문서(없으면 null)다.
export function appOutputRejected(
  tx: Tx,
  ctx: RequestContext,
  document: Document | null,
  prepared: PreparedVersion,
): Result<never> | undefined {
  const app = actingApp(ctx);
  if (app === null) return undefined;
  if (document !== null) {
    if (!isAppPlace(app, document.place)) return absentAnswer(prepared);
  } else if (
    prepared.base_version === null && prepared.metadata !== undefined
  ) {
    // 새 출력 문서: 자기 앱 place에, 출력 이름(문서 이름)을 가진 채로만 만든다.
    // place null도 앱의 자리가 아니라 거절이다(허용 범위가 없는 place null).
    if (!isAppPlace(app, prepared.metadata.place)) {
      return rejected("forbidden", "app writes only its own app place");
    }
    if (prepared.metadata.name === null) {
      return rejected("invalid_input", "app output needs its document name");
    }
  }
  // 앱이 있고 활성일 때만 쓴다. 보관된 앱은 새 출력을 남기지 못한다(registration#R9는
  // 기존 앱 문서의 보존이지 새 출력의 허용이 아니다).
  let lookup;
  try {
    lookup = tx.port(appRegistrationLookup).get(app);
  } catch {
    return rejected("unavailable", "app registration unavailable");
  }
  if (!lookup.ok) return lookup;
  if (lookup.value === null || lookup.value.status !== "active") {
    return rejected("forbidden", "app is not active");
  }
  return undefined;
}

// 판의 출처 release가 자격이 고정한 release와 같은지 본다. 자격에 release 조건이 없으면
// (사람 도구가 앱 자격을 흉내 낸 시험 등) 비교하지 않는다. app 이름은 claimedActor가 본다.
export function releaseClaimed(
  ctx: RequestContext,
  source: PreparedVersion["source"],
): boolean {
  if (source?.kind !== "app") return false;
  const release = ctx.conditions.release;
  return release !== undefined && release !== source.release;
}
