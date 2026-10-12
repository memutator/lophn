// provider 연결 상태. contracts#T29의 providers read를 읽어 화면이
// "provider가 지금 쓸 수 있는지"를 함께 본다. token·key·credential 값은 여기를 지나지 않는다.
import type { CoreSource } from "./connection.ts";

/** provider 하나의 연결 상태(credential 상태). 이 화면이 읽는 field만 옮긴 것이다. */
export type ProviderCredentialState =
  | "available"
  | "rejected"
  | "usage_wait"
  | "revoked";

/** provider 하나. 연결(credential)이 하나라 available이면 쓸 수 있다. */
export interface ProviderState {
  readonly name: string;
  readonly state: ProviderCredentialState;
}

/** provider 연결의 지금 사실. 등록한 연결이 없으면 false다. */
export interface ProviderFacts {
  /** 연결된 provider 중 credential이 available인 것이 하나라도 있다. */
  readonly usable: boolean;
  /** 연결된 provider 목록. 아직 읽지 못했으면 null이다. */
  readonly providers: readonly ProviderState[] | null;
}

export const INITIAL_PROVIDER_FACTS: ProviderFacts = {
  usable: false,
  providers: null,
};

interface ProviderValue {
  name: string;
  credential: { state: string };
}

interface ProviderListValue {
  providers: ProviderValue[];
  next_cursor: string | null;
}

function stateOf(value: string): ProviderCredentialState | null {
  if (value === "available") return "available";
  if (value === "rejected") return "rejected";
  if (value === "usage_wait") return "usage_wait";
  if (value === "revoked") return "revoked";
  return null;
}

function providerOf(value: ProviderValue): ProviderState[] {
  const state = stateOf(value.credential.state);
  return state === null ? [] : [{ name: value.name, state }];
}

function usableOf(providers: readonly ProviderState[]): boolean {
  return providers.some((provider) => provider.state === "available");
}

/** 목록을 끝까지 모을 때 page 상한. 넘으면 모은 것까지만 본다. */
const PAGE_LIMIT = 20;

/** main의 core 통로로 providers read를 읽는다. 이름과 credential 상태만 남긴다. */
export async function readProviderFacts(
  core: CoreSource,
): Promise<ProviderFacts> {
  const providers: ProviderState[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < PAGE_LIMIT; page += 1) {
    let reply;
    try {
      reply = await core.call({
        kind: "read",
        resource: "providers",
        method: "list",
        body: cursor === undefined ? {} : { cursor },
      });
    } catch {
      return INITIAL_PROVIDER_FACTS;
    }
    if (!reply.ok) return INITIAL_PROVIDER_FACTS;
    const value = reply.value as ProviderListValue;
    providers.push(...value.providers.flatMap(providerOf));
    if (value.next_cursor === null) break;
    cursor = value.next_cursor;
  }
  return {
    usable: usableOf(providers),
    providers,
  };
}
