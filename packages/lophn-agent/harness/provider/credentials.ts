// credential 사용 가능 상태와 선택 이동(provider#R8, R10, R24, R27). 순수 함수만.
// IO 없다. preset이 명시한 목록과 순서만 쓴다. 종류 우선·돌려 쓰기·최소 사용·
// 무작위 선택은 없다(R8). affinity는 같은 run의 첫 usable credential에 두고
// 이동은 고정 목록의 같은 provider·model 뒤 계정만 허용한다(R10). 앞 계정 회복에
// 돌아가지 않는다.

import type {
  CallModel,
  ModelOutcome,
  ProviderCredential,
} from "../../../contracts/lophn-agent/mod.ts";

// ---- R27 과금 경로 ----

// API key는 API 과금, ChatGPT·SuperGrok OAuth는 구독이다. Claude OAuth 자리는
// 없다(D31). 확정되지 않은 청구액은 모름이다(R27).
export function billingRouteOf(
  credential: Pick<ProviderCredential, "kind"> | null,
): "api" | "subscription" | "unknown" {
  if (credential === null) return "unknown";
  if (credential.kind === "api_key") return "api";
  if (credential.kind === "oauth") return "subscription";
  // 인증 없음(loopback)은 과금 근거가 없다. 모름이다.
  return "unknown";
}

// ---- 선택 근거 ----

// 선택 판의 한 계정. preset 목록의 한 key와 그 credential이 지금 선택 가능한가의
// 판이다.
export type SelectionEntry = {
  key: string;
  credential: ProviderCredential | null;
};

export type SelectionFacts = {
  // preset이 명시한 목록과 순서(R10). 이 목록 밖 계정은 후보가 아니다.
  credentials: readonly SelectionEntry[];
  // 지금 쓰려는 model 이름. model 전용 대기는 이 model에만 적용된다(R24, R22).
  modelName: string;
  // 지금 시각(ms). usage_wait until 도달 판에 쓴다.
  nowMs: number;
};

// 한 계정이 지금 선택 가능한가. usage_wait는 until 도달까지 막는다(R24). model
// 전용 대기는 그 model에만 막는다(R22, R24). rejected·revoked·disabled 계정은
// 후보에서 뺀다(R4).
export function credentialUsable(
  credential: ProviderCredential | null,
  facts: Pick<SelectionFacts, "modelName" | "nowMs">,
): boolean {
  if (credential === null) return false;
  if (!credential.enabled) return false;
  if (credential.state === "revoked") return false;
  if (credential.state === "rejected") return false;
  if (credential.state === "usage_wait") {
    // usage_wait는 until 도달까지 막는다. until은 waiting 상태에 필수다.
    if (credential.until === null) return false;
    const until = Date.parse(credential.until);
    if (Number.isNaN(until)) return false;
    if (until > facts.nowMs) return false;
  }
  // model 전용 대기는 이 model에만 막는다(R22). 다른 model block은 상관 없다.
  const block = credential.model_blocks.find(
    (entry) => entry.model_name === facts.modelName,
  );
  if (block !== undefined) {
    if (block.until === null) return false;
    const until = Date.parse(block.until);
    if (Number.isNaN(until)) return false;
    if (until > facts.nowMs) return false;
  }
  return true;
}

// ---- R10 affinity와 고정 목록 이동 ----

// run이 지금까지 쓴 credential 기록. affinity의 근원이다(R10). 첫 usable
// credential에 affinity를 두고 실제 선택·판·이동은 ModelCall에 남는다.
export type RunAffinity = {
  // 이 run이 처음 선택한 credential key. 없으면 아직 affinity가 없다.
  key: string | null;
};

// 거절·usage_wait·model 불가 때 preset 목록의 같은 provider·model 뒤 계정만
// 허용한다(R10). 목록이 하나이거나 모두 불가면 멈춘다. 앞 계정으로 돌아가지
// 않고 다른 provider·model·목록 밖 계정으로 자동 이동하지 않는다.
export function nextCredential(
  facts: SelectionFacts,
  affinity: RunAffinity,
  outcome: Pick<ModelOutcome, "kind" | "code"> | null,
): { key: string | null; stop: boolean } {
  // affinity가 아직 없으면 목록의 첫 usable credential이다(R10).
  if (affinity.key === null) {
    const first = facts.credentials.find((entry) =>
      credentialUsable(entry.credential, facts)
    );
    return { key: first?.key ?? null, stop: first === undefined };
  }
  // affinity credential이 아직 usable이면 유지한다(cache 재사용을 지킨다).
  const held = facts.credentials.find((entry) => entry.key === affinity.key);
  if (held !== undefined && credentialUsable(held.credential, facts)) {
    return { key: held.key, stop: false };
  }
  // affinity 계정이 막혔다. outcome이 거절·사용량 대기·model 불가 밖의 판이면
  // 이동 근거가 아니다. 거절·temporary 같은 재시도 가능 판만 뒤 계정을 본다.
  const code = outcome?.code ?? "unknown";
  const movable = code === "temporary" || code === "credential_unavailable" ||
    code === "model_unavailable";
  if (!movable) return { key: null, stop: true };
  // 고정 목록의 affinity 뒤 계정만 본다. 앞 계정 회복에 돌아가지 않는다(R10).
  const index = facts.credentials.findIndex((entry) =>
    entry.key === affinity.key
  );
  const after = index === -1
    ? facts.credentials
    : facts.credentials.slice(index + 1);
  const next = after.find((entry) => credentialUsable(entry.credential, facts));
  return { key: next?.key ?? null, stop: next === undefined };
}

// ---- 초이동 금지 근거 ----

// preset 목록과 model이 같은지. organizing 선택이 다른 provider·계정이면 그
// 명시 선택의 affinity를 쓴다(architecture affinity 문단). 자동 전환은 없다.
export function sameSelection(
  left: { provider: string; modelName: string; credentials: readonly string[] },
  right: {
    provider: string;
    modelName: string;
    credentials: readonly string[];
  },
): boolean {
  return left.provider === right.provider &&
    left.modelName === right.modelName &&
    left.credentials.length === right.credentials.length &&
    left.credentials.every((key, index) => key === right.credentials[index]);
}

// CallModel의 credential 쌍이 이 selection 계정과 같은지. 실제 선택 근거다.
export function credentialMatchesModel(
  entry: SelectionEntry,
  model: Pick<
    CallModel,
    "credential_key" | "credential_revision" | "name" | "provider"
  >,
  provider: string,
): boolean {
  return model.provider === provider && model.name !== "" &&
    entry.key === model.credential_key;
}
