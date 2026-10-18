import type { ProviderDefinition } from "../../../protocol/lophn-agent/mod.ts";
import type { IssuerFetch } from "./oauth.ts";

// ChatGPT 구독 계정이 쓸 수 있는 model 목록이다. 같은 Bearer로 `GET /v1/models`를 읽고 `visibility`가 "list"인 것만 남긴다.
// 아래 칸 이름은 OpenAI 문서에서 옮긴 것이고 진짜 응답으로 확인하기 전이다(첫 live 실행이 확인한다). 틀리면 이 상수만 고친다.
const LIST_FIELD = "data";
const ID_FIELD = "id";
const VISIBILITY_FIELD = "visibility";
const VISIBLE = "list";

// 보이는 id가 하나도 없으면 칸 이름이 틀렸거나 body가 다른 모양이다. 그때는 목록을 모른다고 본다(null):
// 잘못 읽어서 model을 전부 숨기는 쪽이 못 읽는 쪽보다 나쁘다.
export function parseReportedModels(body: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const list = (parsed as Record<string, unknown> | null)?.[LIST_FIELD];
  if (!Array.isArray(list)) return null;
  const names = new Set<string>();
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const entry = item as Record<string, unknown>;
    const id = entry[ID_FIELD];
    const visibility = entry[VISIBILITY_FIELD];
    if (typeof id !== "string" || id.trim() === "") continue;
    if (visibility !== undefined && visibility !== VISIBLE) continue;
    names.add(id);
  }
  return names.size === 0 ? null : [...names].sort();
}

// 읽는 대상은 ChatGPT 로그인 provider뿐이다. SuperGrok·API key provider와 fake 발급자 정의(models_endpoint 없음)는 읽지 않는다.
export function reportedModelsEndpoint(
  definition: ProviderDefinition,
): string | null {
  return definition.oauth?.product === "chatgpt"
    ? definition.models_endpoint
    : null;
}

// 어떤 실패든 null이다(발급자 대기열 기한, runtime 없음, 200이 아님, 큰 body). token을 오류나 log에 싣지 않는다.
export async function readReportedModels(
  http: IssuerFetch,
  endpoint: string,
  access: string,
): Promise<string[] | null> {
  try {
    const response = await http(endpoint, {
      method: "GET",
      headers: {
        authorization: `Bearer ${access}`,
        accept: "application/json",
      },
    });
    return response.status === 200
      ? parseReportedModels(await response.text())
      : null;
  } catch {
    return null;
  }
}
