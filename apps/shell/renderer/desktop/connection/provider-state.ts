// provider 연결 상태(shell/desktop#R7). contracts#T29의 providers read를 읽어 화면이
// "provider가 지금 쓸 수 있는지"를 함께 본다. token·key·credential 값은 여기를 지나지 않는다.
import type { CoreSource } from "./connection.ts";

/** provider 하나의 계정 사실(credential 상태). 이 화면이 읽는 field만 옮긴 것이다. */
export interface ProviderAccount {
  readonly key: string;
  readonly state: "available" | "rejected" | "usage_wait" | "revoked";
}

/** provider 하나. 계정이 둘 이상일 때 available인 계정이 하나면 쓸 수 있다. */
export interface ProviderState {
  readonly name: string;
  readonly enabled: boolean;
  readonly accounts: readonly ProviderAccount[];
}

/** provider 연결의 지금 사실. 등록한 연결이 없으면 false다. */
export interface ProviderFacts {
  /** 등록한 연결 중 enabled이고 available 계정이 하나라도 있는 provider가 있다. */
  readonly usable: boolean;
  /** 등록한 연결 목록. 아직 읽지 못했으면 null이다. */
  readonly providers: readonly ProviderState[] | null;
}

export const INITIAL_PROVIDER_FACTS: ProviderFacts = {
  usable: false,
  providers: null,
};

interface ProviderValue {
  name: string;
  enabled: boolean;
  credentials: { key: string; state: string }[];
}

interface ProviderListValue {
  providers: ProviderValue[];
  next_cursor: string | null;
}

function stateOf(value: string): ProviderAccount["state"] | null {
  if (value === "available") return "available";
  if (value === "rejected") return "rejected";
  if (value === "usage_wait") return "usage_wait";
  if (value === "revoked") return "revoked";
  return null;
}

function providerOf(value: ProviderValue): ProviderState {
  return {
    name: value.name,
    enabled: value.enabled,
    accounts: value.credentials.flatMap((credential) => {
      const state = stateOf(credential.state);
      return state === null ? [] : [{ key: credential.key, state }];
    }),
  };
}

function usableOf(providers: readonly ProviderState[]): boolean {
  return providers.some((provider) =>
    provider.enabled &&
    provider.accounts.some((account) => account.state === "available")
  );
}

/** 목록을 끝까지 모을 때 page 상한. 넘으면 모은 것까지만 본다. */
const PAGE_LIMIT = 20;

/** main의 core 통로로 providers read를 읽는다. 계정 상태와 enabled만 남긴다. */
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
    providers.push(...value.providers.map(providerOf));
    if (value.next_cursor === null) break;
    cursor = value.next_cursor;
  }
  return {
    usable: usableOf(providers),
    providers,
  };
}
