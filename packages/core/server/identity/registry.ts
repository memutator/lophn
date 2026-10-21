import {
  type Clock,
  err,
  type Logger,
  ok,
  type RandomSource,
  type Result,
  sha256Hex,
} from "../../../base/mod.ts";
import { createHash } from "node:crypto";
import {
  type AuthenticatedContext,
  authenticatedContextSchema,
  type CredentialConditions,
  type CredentialScope,
  credentialScopeSchema,
} from "../../../protocol/server/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import {
  authorize,
  conditionsMatch,
  type CredentialTarget,
  intersectScope,
  operationCeiling,
  type OperationPolicy,
  scopeWithin,
} from "./model.ts";

export type CredentialIssue = {
  // user·machine은 종류 문자열이고 나머지는 kind:id Actor다. agent runtime 경계만 agent credential을,
  // app supervisor만 app credential을, coding session 쪽만 coding_agent credential을 발급한다.
  actor:
    | "user"
    | "machine"
    | `agent:${string}`
    | `app:${string}`
    | `coding_agent:${string}`;
  principal: string;
  scope: CredentialScope;
  conditions: CredentialConditions;
  expires_at?: string;
};

type CurrentCredential = {
  scope: CredentialScope;
  conditions: CredentialConditions;
};

type CredentialRegistryOptions = {
  epoch: string;
  random: RandomSource;
  clock: Clock;
  operations: readonly OperationPolicy[];
  // 발급 때 한 번. 실패는 발급 거절(unauthorized)이다.
  current?: (ctx: AuthenticatedContext) => Result<CurrentCredential>;
  // 매 사용. 실패는 그 사용만 거절하고 발급은 막지 않는다.
  live?: (ctx: AuthenticatedContext) => Result<CurrentCredential>;
  logger?: Logger;
};

type CredentialRecord = {
  digest: Uint8Array;
  epoch: string;
  context: AuthenticatedContext;
  state: "active" | "revoked" | "ended";
};

function unauthorized(): Result<never> {
  return err({ code: "unauthorized", message: "credential unavailable" });
}

function invalid(): Result<never> {
  return err({
    code: "invalid_input",
    message: "invalid credential scope or kind",
  });
}

// app 발급은 actor 문자열의 kind가 app이다. app:<id> actor가 아니다.
function actorKind(actor: string): string | undefined {
  return parseActor(actor)?.kind;
}

function digestBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g)!, (pair) => parseInt(pair, 16));
}

// 발급은 동기여야 해서(CodingTokens port) 동기 hash를 쓴다.
function digestOf(token: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(token).digest());
}

function constantTimeDigestEqual(
  left: Uint8Array,
  right: Uint8Array,
): boolean {
  if (left.length !== 32 || right.length !== 32) return false;
  let difference = 0;
  for (let i = 0; i < 32; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

function randomValue(random: RandomSource): string {
  const bytes = new Uint8Array(32);
  random.fill(bytes);
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-")
    .replaceAll("/", "_").replaceAll("=", "");
}

export class CredentialRegistry {
  #records = new Map<string, CredentialRecord>();
  #userIssued = false;
  #options: CredentialRegistryOptions;

  constructor(options: CredentialRegistryOptions) {
    if (!options.epoch) throw new TypeError("core epoch required");
    this.#options = {
      ...options,
      operations: structuredClone(options.operations),
    };
  }

  issue(
    input: CredentialIssue,
  ): Result<{ token: string; credential_ref: string }> {
    let userReserved = false;
    try {
      const parsedScope = credentialScopeSchema.safeParse({
        operations: input.scope.operations,
        targets: input.scope.targets,
      });
      const kind = actorKind(input.actor);
      const parsed = parsedScope.success
        ? authenticatedContextSchema.safeParse({
          principal: input.principal,
          actor: input.actor,
          scope: parsedScope.data,
          conditions: input.conditions,
          credential_ref: "pending",
          ...(input.expires_at === undefined
            ? {}
            : { expires_at: input.expires_at }),
        })
        : undefined;
      if (
        !parsed?.success ||
        (kind !== "user" && kind !== "machine" && kind !== "app" &&
          kind !== "agent" && kind !== "coding_agent")
      ) return invalid();
      const context: AuthenticatedContext = parsed.data;
      // agent의 앱 조건(App Engineer의 담당 앱)은 target을 앱에 고정하지 않는다. 앱 없는 대상(SDK 계약,
      // handoff 고정 근거)도 닿아야 하고, 범위는 ledger의 target 판정이 앱 조건으로 가른다.
      if (
        kind !== "agent" && context.conditions.app !== undefined &&
        context.scope.targets.app !== context.conditions.app
      ) return invalid();
      if (
        kind === "user" &&
        (input.principal !== "user" || !context.conditions.process)
      ) return invalid();
      if (
        kind === "machine" &&
        (!context.conditions.task || !context.conditions.process ||
          context.scope.targets.task !== context.conditions.task ||
          context.scope.operations.length === 0 ||
          Object.keys(context.scope.targets).length === 0)
      ) return invalid();
      // app 자격은 supervisor가 고정 app·release·process·mode로 요청한다.
      // 조건에 없는 target을 넓혀도 같은 조건으로 고정한다.
      if (kind === "app") {
        // release는 live에 필수다. 준비 전 bundle의 preview는 release 없이 bundle hash로 고정한다.
        const releaseless = context.conditions.release === undefined &&
          context.conditions.mode !== undefined &&
          context.conditions.mode !== "live" &&
          context.conditions.bundle_hash !== undefined;
        if (
          !context.conditions.app ||
          (!context.conditions.release && !releaseless) ||
          !context.conditions.process || !context.conditions.mode
        ) return invalid();
        if (
          context.scope.targets.app !== context.conditions.app ||
          context.scope.targets.release !== context.conditions.release ||
          context.scope.targets.process !== context.conditions.process ||
          context.scope.targets.mode !== context.conditions.mode
        ) return invalid();
      }
      // agent credential은 session 하나와 그 안에서 도는 turn 하나에 묶인다. actor가 그 session이다.
      if (kind === "agent") {
        if (
          !context.conditions.turn || !context.conditions.session ||
          context.conditions.session !== input.actor.slice("agent:".length) ||
          context.scope.targets.session !== context.conditions.session ||
          context.scope.targets.turn !== context.conditions.turn
        ) return invalid();
      }
      // coding token은 session 하나가 받은 앱 하나에 묶인다. 만료는 없고 session이 끝날 때 거둔다.
      if (kind === "coding_agent") {
        if (!context.conditions.app || input.principal !== input.actor) {
          return invalid();
        }
      }
      if (
        context.expires_at !== undefined &&
        Date.parse(context.expires_at) <= this.#options.clock.nowMs()
      ) return invalid();
      const ceiling: CredentialScope = {
        operations: operationCeiling(input.actor, this.#options.operations),
        targets: {},
      };
      if (!scopeWithin(context.scope, ceiling)) return invalid();
      const restrict = this.#options.current ?? this.#options.live;
      if (restrict) {
        const current = restrict(structuredClone(context));
        if (!current.ok) return unauthorized();
        if (
          !conditionsMatch(context.conditions, current.value.conditions) ||
          !scopeWithin(context.scope, current.value.scope)
        ) return invalid();
      }
      if (kind === "user") {
        if (this.#userIssued) {
          return err({
            code: "conflict",
            message: "user credential already issued",
          });
        }
        this.#userIssued = true;
        userReserved = true;
      }
      const token = randomValue(this.#options.random);
      const credential_ref = randomValue(this.#options.random);
      const digest = digestOf(token);
      if (
        token === credential_ref || this.#records.has(credential_ref) ||
        [...this.#records.values()].some((record) =>
          constantTimeDigestEqual(record.digest, digest)
        )
      ) {
        if (userReserved) this.#userIssued = false;
        return err({
          code: "unavailable",
          message: "credential generation unavailable",
        });
      }
      context.credential_ref = credential_ref;
      this.#records.set(credential_ref, {
        digest,
        context,
        epoch: this.#options.epoch,
        state: "active",
      });
      return ok({ token, credential_ref });
    } catch {
      if (userReserved) this.#userIssued = false;
      return err({
        code: "unavailable",
        message: "credential generation unavailable",
      });
    }
  }

  async authenticate(
    bearer: string,
  ): Promise<
    Result<AuthenticatedContext & { scope: CredentialScope }>
  > {
    try {
      if (typeof bearer !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(bearer)) {
        return this.#denied();
      }
      const digest = digestBytes(await sha256Hex(bearer));
      let found: CredentialRecord | undefined;
      // digest를 index key로 쓰지 않아 검증이 항상 32 bytes 비교를 거친다.
      for (const record of this.#records.values()) {
        if (constantTimeDigestEqual(record.digest, digest)) found = record;
      }
      if (found) return this.#context(found);
      return this.#denied();
    } catch {
      return this.#denied();
    }
  }

  revalidate(
    ctx: Pick<AuthenticatedContext, "credential_ref">,
  ): Result<AuthenticatedContext & { scope: CredentialScope }> {
    const record = this.#records.get(ctx.credential_ref);
    return record ? this.#context(record) : this.#denied();
  }

  authorize(
    ctx: Pick<AuthenticatedContext, "credential_ref">,
    operation: string,
    target?: CredentialTarget,
  ): Result<void> {
    const current = this.revalidate(ctx);
    return current.ok ? authorize(current.value, operation, target) : current;
  }

  revoke(credentialRef: string): Result<void> {
    return this.#finish(credentialRef, "revoked");
  }

  end(credentialRef: string): Result<void> {
    return this.#finish(credentialRef, "ended");
  }

  // `kind`를 주면 그 actor 종류만 끝낸다. 같은 앱 조건을 가진 coding token 같은 다른 종류는 남는다.
  endBy(
    condition: "app" | "task" | "process" | "turn" | "session" | "release",
    value: string,
    kind?: string,
  ): number {
    let ended = 0;
    for (const record of this.#records.values()) {
      if (
        record.state === "active" &&
        record.context.conditions[condition] === value &&
        (kind === undefined || actorKind(record.context.actor) === kind)
      ) {
        record.state = "ended";
        ended++;
      }
    }
    return ended;
  }

  #finish(credentialRef: string, state: "revoked" | "ended"): Result<void> {
    const record = this.#records.get(credentialRef);
    if (!record) return unauthorized();
    if (record.state === "active") record.state = state;
    return ok(undefined);
  }

  #context(
    record: CredentialRecord,
  ): Result<AuthenticatedContext & { scope: CredentialScope }> {
    if (
      record.state !== "active" || record.epoch !== this.#options.epoch ||
      (record.context.expires_at !== undefined &&
        Date.parse(record.context.expires_at) <= this.#options.clock.nowMs())
    ) return this.#denied();
    const context = structuredClone(record.context);
    try {
      const live = this.#options.live ?? this.#options.current;
      if (live) {
        const current = live(structuredClone(context));
        if (
          !current.ok ||
          !conditionsMatch(context.conditions, current.value.conditions)
        ) return this.#denied();
        context.scope = intersectScope(context.scope, current.value.scope);
      }
      return ok(context);
    } catch {
      return this.#denied();
    }
  }

  #denied(): Result<never> {
    try {
      this.#options.logger?.warn({
        component: "identity",
        event: "credential_denied",
      });
    } catch {
      // log sink 고장이 인증 거절의 안전한 오류를 바꾸지 못한다.
    }
    return unauthorized();
  }
}
