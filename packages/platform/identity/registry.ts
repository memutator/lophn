import {
  type Clock,
  err,
  type Logger,
  ok,
  type RandomSource,
  type Result,
  sha256Hex,
} from "../../base/mod.ts";
import {
  type AuthenticatedContext,
  authenticatedContextSchema,
  type CredentialConditions,
  type CredentialScope,
  parseActor,
} from "../../contracts/platform/mod.ts";
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
  // user·machine은 종류 문자열이고 app은 app:<id> Actor다.
  actor: "user" | "machine" | `app:${string}`;
  principal: string;
  scope: CredentialScope;
  conditions: CredentialConditions;
  expires_at?: string;
  test_runner?: boolean;
};

export type CurrentCredential = {
  scope: CredentialScope;
  conditions: CredentialConditions;
};

export type CredentialRegistryOptions = {
  epoch: string;
  random: RandomSource;
  clock: Clock;
  operations: readonly OperationPolicy[];
  current?: (ctx: AuthenticatedContext) => Result<CurrentCredential>;
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

export function constantTimeDigestEqual(
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

  async issue(
    input: CredentialIssue,
  ): Promise<Result<{ token: string; credential_ref: string }>> {
    let userReserved = false;
    try {
      const parsed = authenticatedContextSchema.safeParse({
        principal: input.principal,
        actor: input.actor,
        scope: input.scope,
        conditions: input.conditions,
        credential_ref: "pending",
        ...(input.expires_at === undefined
          ? {}
          : { expires_at: input.expires_at }),
      });
      const kind = actorKind(input.actor);
      if (
        !parsed.success ||
        (kind !== "user" && kind !== "machine" && kind !== "app")
      ) return invalid();
      const context = parsed.data;
      if (
        input.test_runner !== undefined &&
        typeof input.test_runner !== "boolean"
      ) return invalid();
      if (
        context.conditions.app !== undefined &&
        context.scope.targets.app !== context.conditions.app
      ) return invalid();
      if (
        kind === "user" &&
        (input.principal !== "user" || input.test_runner ||
          !context.conditions.process)
      ) return invalid();
      if (
        kind === "machine" &&
        (!context.conditions.task || !context.conditions.process ||
          context.scope.targets.task !== context.conditions.task ||
          context.scope.operations.length === 0 ||
          Object.keys(context.scope.targets).length === 0)
      ) return invalid();
      // app 자격은 supervisor가 고정 app·release·process·mode로 요청한다
      // (architecture/platform 5.6). 조건에 없는 target을 넓혀도 같은 조건으로 고정한다.
      if (kind === "app") {
        if (
          !context.conditions.app || !context.conditions.release ||
          !context.conditions.process || !context.conditions.mode
        ) return invalid();
        if (
          context.scope.targets.app !== context.conditions.app ||
          context.scope.targets.release !== context.conditions.release ||
          context.scope.targets.process !== context.conditions.process ||
          context.scope.targets.mode !== context.conditions.mode
        ) return invalid();
      }
      if (
        context.expires_at !== undefined &&
        Date.parse(context.expires_at) <= this.#options.clock.nowMs()
      ) return invalid();
      const ceiling = {
        operations: operationCeiling(
          input.actor,
          this.#options.operations,
          input.test_runner,
        ),
        targets: {},
      };
      if (!scopeWithin(context.scope, ceiling)) return invalid();
      if (this.#options.current) {
        const current = this.#options.current(structuredClone(context));
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
        // hash를 기다리는 동안 다른 hello가 두 번째 user token을 만들지 못한다.
        this.#userIssued = true;
        userReserved = true;
      }
      const token = randomValue(this.#options.random);
      const credential_ref = randomValue(this.#options.random);
      const digest = digestBytes(await sha256Hex(token));
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

  async authenticate(bearer: string): Promise<Result<AuthenticatedContext>> {
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
      return found ? this.#context(found) : this.#denied();
    } catch {
      return this.#denied();
    }
  }

  revalidate(
    ctx: Pick<AuthenticatedContext, "credential_ref">,
  ): Result<AuthenticatedContext> {
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

  endBy(
    condition: "task" | "process" | "run" | "assignment",
    value: string,
  ): number {
    let ended = 0;
    for (const record of this.#records.values()) {
      if (
        record.state === "active" &&
        record.context.conditions[condition] === value
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

  #context(record: CredentialRecord): Result<AuthenticatedContext> {
    if (
      record.state !== "active" || record.epoch !== this.#options.epoch ||
      (record.context.expires_at !== undefined &&
        Date.parse(record.context.expires_at) <= this.#options.clock.nowMs())
    ) return this.#denied();
    const context = structuredClone(record.context);
    try {
      if (this.#options.current) {
        const current = this.#options.current(structuredClone(context));
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
