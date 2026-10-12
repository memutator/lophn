// coding agent connection credential의 발급·보관 준비·보호 전달(platform/identity#R5, R15,
// platform/secrets#R12). 신뢰 인증 경계가 core command 밖에서 token을 만들고 keychain에 준비한 뒤
// 검증 digest만 connection command에 낸다. token 원문은 이 module의 지역 값과 keychain,
// 지정 child의 보호 통로에만 있고 결과·오류·log·event에 나오지 않는다.

import {
  err,
  type IdSource,
  type Logger,
  ok,
  type RandomSource,
  type Result,
  sha256Hex,
} from "../../../base/mod.ts";
import {
  type CodingAgentConnectionAuthPort,
  type ConnectionId,
  connectionIdSchema,
  type ConnectionScope,
  connectionScopeSchema,
  CREDENTIAL_DELIVERY_TIMEOUT_MS,
  type CredentialDeliveryFailure,
  type CredentialDeliveryFailureBody,
  credentialDeliveryRequestSchema,
  credentialDeliveryResponseSchema,
  LOPHN_CONNECTION,
} from "../../../protocol/coding-agent/mod.ts";
import { constantTimeDigestEqual } from "./registry.ts";
import type {
  ExternalCredential,
  ExternalCredentialResolver,
} from "./registry.ts";

// OS keychain 쪽 준비·읽기·정리다. platform/secrets가 구현하고 이 경계는 모양만 안다.
export type CodingCredentialVault = {
  prepare(connection: string, token: string): Promise<Result<void>>;
  read(connection: string): Promise<Result<string, CredentialDeliveryFailure>>;
  discard(connection: string): Promise<Result<void>>;
  // 고정 위치 이름 공간의 connection id 목록(값 없음). 시작 때 중단 고아를 찾는다.
  list(): Promise<Result<readonly string[]>>;
};

// 준비했지만 commit 결과를 아직 모르는 connection의 기록이다. 중단 뒤 고아를 찾는 근거이며 값이
// 없다. 제품 조립은 재시작을 견디는 구현을 준다.
export type PendingPreparations = {
  add(connection: string): Promise<void>;
  remove(connection: string): Promise<void>;
  list(): Promise<readonly string[]>;
};

export function memoryPendingPreparations(): PendingPreparations {
  const pending = new Set<string>();
  return {
    add(connection) {
      pending.add(connection);
      return Promise.resolve();
    },
    remove(connection) {
      pending.delete(connection);
      return Promise.resolve();
    },
    list() {
      return Promise.resolve([...pending]);
    },
  };
}

// 보호 통로의 OS별 구현은 → redesign/propagate#Q2. non-inheritable로 지정 child에만 쓴다.
export type ProtectedChannel = {
  send(
    child: { process_generation: string; loader_identity: string },
    token: Uint8Array,
  ): Promise<Result<void>>;
};

// 신뢰 감독 경계가 관측해 등록하는 지정 child다. 요청 본문이 아니라 이 기록이 child를 정한다.
export type CodingLoaderChild = {
  process_generation: string;
  loader_identity: string;
  connection: ConnectionId;
  scope: ConnectionScope;
};

export type CodingCredentialAuthorityOptions = {
  random: RandomSource;
  ids: IdSource;
  vault: CodingCredentialVault;
  // 소유 module의 principal 조회. 매 사용마다 현재 state·digest를 읽는다.
  auth: CodingAgentConnectionAuthPort;
  // 설치된 보호 loader의 identity 목록. 목록 밖 identity는 child로 등록되지 않는다.
  loaders: readonly string[];
  pending?: PendingPreparations;
  logger?: Logger;
};

// 연결 결정 뒤 발급 경계가 submit에 넘기는 값. 원문 token은 없다.
export type CodingConnectionSubmission = {
  id: ConnectionId;
  label: string;
  scope: ConnectionScope;
  token_digest: string;
};

export type CodingCredentialAuthority = ExternalCredentialResolver & {
  // 사람이 고른 label·scope로 token을 만들고 keychain에 준비해 digest만 submit한다. 준비·commit
  // 실패·중단의 token은 정리하고 성공 표시를 만들지 않는다. 결과에는 connection 참조만 있다.
  connect(
    input: { label: string; scope: ConnectionScope },
    submit: (input: CodingConnectionSubmission) => Promise<Result<unknown>>,
    signal?: AbortSignal,
  ): Promise<Result<{ connection: ConnectionId }>>;
  // 재시작 때 commit 결과를 모른 채 남은 준비를 정리한다. commit된 것은 살리고 아닌 것만 지운다.
  // 기록이 없어도 keychain의 고정 위치 목록으로 commit된 active connection이 없는 고아를 찾는다.
  recover(): Promise<{ kept: number; discarded: number; retry: number }>;
  // 재시작 때 active connection의 digest를 다시 읽어 인증 색인을 채운다.
  restore(connections: readonly string[]): Promise<number>;
  // active connection의 현재 인증 값. 없거나 회수됐으면 undefined다. 원장 credential 기록에 쓴다.
  credentialFor(connection: string): Promise<ExternalCredential | undefined>;
  registerChild(child: CodingLoaderChild): Result<void>;
  endChild(processGeneration: string): void;
  endConnection(connection: string): number;
  // 신뢰 loader만 부른다. 확인을 모두 통과한 지정 child의 보호 통로에만 token을 쓴다.
  deliver(
    request: unknown,
    channel: ProtectedChannel,
  ): Promise<Result<void, CredentialDeliveryFailure>>;
};

function unavailable(): Result<never> {
  return err({
    code: "unavailable",
    message: "credential 준비를 사용할 수 없다",
  });
}

function randomToken(random: RandomSource): string {
  const bytes = new Uint8Array(32);
  random.fill(bytes);
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-")
    .replaceAll("/", "_").replaceAll("=", "");
}

function hexBytes(hex: string): Uint8Array | undefined {
  return /^[0-9a-f]{64}$/.test(hex)
    ? Uint8Array.from(hex.match(/../g)!, (pair) => parseInt(pair, 16))
    : undefined;
}

function principalOf(connection: string): string {
  return `coding_agent:${connection}`;
}

// connection이 발급받는 자격의 대상 범위·조건이다. 앱 하나 범위는 `targets.app`과 `conditions.app`이고
// owner(documents·apps·problems)는 자기 target의 앱을 직접 줘서 이 범위와 맞춘다.
export function externalOf(
  connection: string,
  scope: ConnectionScope,
): ExternalCredential {
  const app = scope.kind === "app" ? scope.app : undefined;
  return {
    actor: `coding_agent:${connection}`,
    principal: principalOf(connection),
    targets: app === undefined ? {} : { app },
    conditions: app === undefined ? {} : { app },
  };
}

function sameScope(left: ConnectionScope, right: ConnectionScope): boolean {
  return left.kind === right.kind && left.app === right.app;
}

export function createCodingCredentialAuthority(
  options: CodingCredentialAuthorityOptions,
): CodingCredentialAuthority {
  const pending = options.pending ?? memoryPendingPreparations();
  const loaders = new Set(options.loaders);
  // principal → 검증 digest 색인. 인증이 bearer의 digest에서 connection을 찾는 데만 쓴다.
  const index = new Map<string, Uint8Array>();
  const children = new Map<string, CodingLoaderChild>();
  // 이 process에서 준비 중이라 commit 결과가 아직 정해지지 않은 connection. 고아 정리가 건드리지 않는다.
  const inflight = new Set<string>();

  function denied(event: string): void {
    try {
      options.logger?.warn({ component: "identity", event });
    } catch {
      // log sink 고장이 거절의 모양을 바꾸지 못한다.
    }
  }

  // 소유 module의 현재 기록. 읽지 못한 것(error)과 없는 것(absent)을 구별한다.
  async function currentOf(connection: string): Promise<
    | { status: "error" }
    | { status: "absent" }
    | {
      status: "found";
      digest: Uint8Array;
      state: string;
      scope: ConnectionScope;
    }
  > {
    try {
      const read = await options.auth(principalOf(connection));
      if (read === undefined) return { status: "absent" };
      const digest = hexBytes(read.token_digest);
      return digest === undefined
        ? { status: "error" }
        : { status: "found", digest, state: read.state, scope: read.scope };
    } catch {
      return { status: "error" };
    }
  }

  async function discardPrepared(connection: string): Promise<boolean> {
    const removed = await options.vault.discard(connection);
    // 이미 없는 것도 정리된 상태다. 지웠는지 확인하지 못한 것만 남긴다.
    return removed.ok || removed.error.code === "not_found";
  }

  async function attempt(
    connection: ConnectionId,
    label: string,
    scope: ConnectionScope,
    submit: (input: CodingConnectionSubmission) => Promise<Result<unknown>>,
    signal: AbortSignal | undefined,
  ): Promise<Result<{ connection: ConnectionId }>> {
    let token: string | undefined = randomToken(options.random);
    const digestHex = await sha256Hex(token);
    await pending.add(connection);
    const prepared = await options.vault.prepare(connection, token);
    token = undefined;
    if (!prepared.ok) {
      // 보관하지 못한 것은 만들지 않은 것이다. 일부 쓴 흔적이 있으면 지운다.
      if (await discardPrepared(connection)) await pending.remove(connection);
      return unavailable();
    }
    if (signal?.aborted) {
      if (await discardPrepared(connection)) await pending.remove(connection);
      return unavailable();
    }
    let submitted: Result<unknown>;
    try {
      submitted = await submit({
        id: connection,
        label,
        scope,
        token_digest: digestHex,
      });
    } catch {
      submitted = unavailable();
    }
    if (submitted.ok) {
      index.set(principalOf(connection), hexBytes(digestHex)!);
      await pending.remove(connection);
      return ok({ connection });
    }
    // 응답을 잃은 실패는 commit됐을 수 있다. 소유 module에서 digest를 다시 읽어 확인한다.
    const current = await currentOf(connection);
    if (current.status === "error") {
      // 확인할 수 없으면 지우지 않고 기록에 남겨 recover가 결정한다.
      return submitted;
    }
    if (
      current.status === "found" &&
      constantTimeDigestEqual(current.digest, hexBytes(digestHex)!)
    ) {
      index.set(principalOf(connection), current.digest);
      await pending.remove(connection);
      return ok({ connection });
    }
    if (await discardPrepared(connection)) await pending.remove(connection);
    return submitted;
  }

  return {
    async connect(input, submit, signal) {
      const scope = connectionScopeSchema.safeParse(input.scope);
      if (!scope.success || !/\S/.test(input.label)) {
        return err({
          code: "invalid_input",
          message: "연결 이름 또는 범위가 올바르지 않다",
        });
      }
      const id = connectionIdSchema.safeParse(options.ids.newId("cac"));
      if (!id.success) return unavailable();
      const connection = id.data;
      inflight.add(connection);
      try {
        return await attempt(
          connection,
          input.label,
          scope.data,
          submit,
          signal,
        );
      } finally {
        inflight.delete(connection);
      }
    },
    async recover() {
      let kept = 0;
      let discarded = 0;
      let retry = 0;
      const handled = new Set<string>();
      for (const connection of await pending.list()) {
        if (inflight.has(connection)) continue;
        handled.add(connection);
        const current = await currentOf(connection);
        if (current.status === "error") {
          retry++;
        } else if (current.status === "found") {
          // commit된 connection의 credential이다. 지우지 않는다.
          index.set(principalOf(connection), current.digest);
          await pending.remove(connection);
          kept++;
        } else if (await discardPrepared(connection)) {
          await pending.remove(connection);
          discarded++;
        } else retry++;
      }
      // 기록을 잃은 고아(재시작 사이에 기록이 없는 준비)는 keychain의 고정 위치 목록으로 찾는다.
      // commit된 connection이 없는 위치만 지운다. 목록을 못 읽으면 지우지 않는다.
      const listed = await options.vault.list();
      if (listed.ok) {
        for (const connection of listed.value) {
          if (handled.has(connection) || inflight.has(connection)) continue;
          const current = await currentOf(connection);
          if (current.status === "error") {
            retry++;
          } else if (current.status === "found") {
            index.set(principalOf(connection), current.digest);
            kept++;
          } else if (await discardPrepared(connection)) {
            discarded++;
          } else retry++;
        }
      }
      return { kept, discarded, retry };
    },

    async restore(connections) {
      let restored = 0;
      for (const connection of connections) {
        if (!connectionIdSchema.safeParse(connection).success) continue;
        const current = await currentOf(connection);
        if (current.status !== "found" || current.state !== "active") continue;
        index.set(principalOf(connection), current.digest);
        restored++;
      }
      return restored;
    },

    async resolve(digest): Promise<ExternalCredential | undefined> {
      let matched: string | undefined;
      // 모든 항목을 같은 비교로 훑어 어느 connection이 맞는지가 시간에 드러나지 않게 한다.
      for (const [principal, known] of index) {
        if (constantTimeDigestEqual(known, digest)) matched = principal;
      }
      if (matched === undefined) return undefined;
      const connection = matched.slice("coding_agent:".length);
      const current = await currentOf(connection);
      if (
        current.status !== "found" || current.state !== "active" ||
        !constantTimeDigestEqual(current.digest, digest)
      ) {
        denied("coding_credential_denied");
        return undefined;
      }
      return externalOf(connection, current.scope);
    },

    async credentialFor(connection) {
      const current = await currentOf(connection);
      if (current.status !== "found" || current.state !== "active") {
        return undefined;
      }
      return externalOf(connection, current.scope);
    },

    registerChild(child) {
      const connection = connectionIdSchema.safeParse(child.connection);
      const scope = connectionScopeSchema.safeParse(child.scope);
      if (
        !connection.success || !scope.success ||
        child.process_generation.length === 0 ||
        !loaders.has(child.loader_identity)
      ) {
        denied("coding_loader_rejected");
        return err({
          code: "forbidden",
          message: "loader child를 등록할 수 없다",
        });
      }
      children.set(child.process_generation, {
        ...child,
        connection: connection.data,
        scope: scope.data,
      });
      return ok(undefined);
    },

    endChild(processGeneration) {
      children.delete(processGeneration);
    },

    endConnection(connection) {
      let ended = 0;
      for (const [generation, child] of children) {
        if (child.connection === connection) {
          children.delete(generation);
          ended++;
        }
      }
      return ended;
    },

    async deliver(request, channel) {
      // 범위 밖 요청은 모두 같은 답이다. 어느 확인에서 막혔는지 알리지 않는다.
      const refuse = (): Result<never, CredentialDeliveryFailure> => {
        denied("coding_credential_denied");
        return err("not_found");
      };
      const parsed = credentialDeliveryRequestSchema.safeParse(request);
      if (!parsed.success) return refuse();
      const child = children.get(parsed.data.process_generation);
      if (
        child === undefined ||
        child.loader_identity !== parsed.data.loader_identity ||
        child.connection !== parsed.data.connection ||
        !loaders.has(parsed.data.loader_identity)
      ) return refuse();
      const current = await currentOf(parsed.data.connection);
      if (
        current.status !== "found" || current.state !== "active" ||
        !sameScope(current.scope, child.scope)
      ) return refuse();
      const read = await options.vault.read(parsed.data.connection);
      if (!read.ok) return read;
      const bytes = new TextEncoder().encode(read.value);
      try {
        // keychain 값이 commit된 digest와 다르면 쓸 수 없다. 자동 재발급은 없다.
        const check = hexBytes(await sha256Hex(bytes));
        if (
          check === undefined || !constantTimeDigestEqual(check, current.digest)
        ) {
          return err("not_found");
        }
        const sent = await channel.send({
          process_generation: child.process_generation,
          loader_identity: child.loader_identity,
        }, bytes);
        return sent.ok ? ok(undefined) : err("no_secret_service");
      } finally {
        bytes.fill(0);
      }
    },
  };
}

// helper `lophn-credential`의 처리. stdin 요청 bytes를 받아 stdout bytes나 실패 이유를 낸다.
// token은 성공 응답의 stdout에만 있다. 5초 안에 끝나지 않으면 timeout이다.
export async function serveCredentialDelivery(
  authority: Pick<CodingCredentialAuthority, "deliver">,
  stdin: Uint8Array,
  options: { timeoutMs?: number } = {},
): Promise<
  | { ok: true; stdout: Uint8Array }
  | { ok: false; body: CredentialDeliveryFailureBody }
> {
  let request: unknown;
  try {
    request = JSON.parse(new TextDecoder().decode(stdin));
  } catch {
    return { ok: false, body: { reason: "not_found" } };
  }
  let stdout: Uint8Array | undefined;
  const channel: ProtectedChannel = {
    send(_child, token) {
      stdout = token.slice();
      return Promise.resolve(ok(undefined));
    },
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Result<void, CredentialDeliveryFailure>>(
    (resolve) => {
      timer = setTimeout(
        () => resolve(err("timeout")),
        options.timeoutMs ?? CREDENTIAL_DELIVERY_TIMEOUT_MS,
      );
    },
  );
  let delivered: Result<void, CredentialDeliveryFailure>;
  try {
    delivered = await Promise.race([
      authority.deliver(request, channel),
      timeout,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  if (!delivered.ok || stdout === undefined) {
    stdout?.fill(0);
    return {
      ok: false,
      body: { reason: delivered.ok ? "not_found" : delivered.error },
    };
  }
  const body = credentialDeliveryResponseSchema.safeParse({
    token: new TextDecoder().decode(stdout),
  });
  stdout.fill(0);
  return body.success
    ? { ok: true, stdout: new TextEncoder().encode(JSON.stringify(body.data)) }
    : { ok: false, body: { reason: "not_found" } };
}

// lophn이 [Start]로 여는 coding TUI process의 환경이다. connection 참조만 있고 token은 없다.
// 그 아래 MCP·CLI가 loader로 받는다. TUI 전용 보호 전달 길은 없다.
export function codingTuiEnvironment(
  connection: string,
): Result<Record<string, string>> {
  const parsed = connectionIdSchema.safeParse(connection);
  if (!parsed.success) {
    return err({
      code: "invalid_input",
      message: "connection 참조가 올바르지 않다",
    });
  }
  return ok({ [LOPHN_CONNECTION]: parsed.data });
}
