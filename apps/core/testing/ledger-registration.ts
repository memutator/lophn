import {
  createIdSource,
  err,
  manualClock,
  ok,
  type Result,
  seededRandom,
} from "../../../packages/base/mod.ts";
import {
  type AuthenticatedContext,
  authenticatedContextSchema,
  type CommandDefinition,
  type ReadDefinition,
  type RequestContext,
  routePath,
  type SchemaStep,
  type Tx,
} from "../../../packages/protocol/server/mod.ts";
import {
  confirmationBridge,
  ConfirmationRegistry,
} from "../../../packages/core/server/identity/mod.ts";
import {
  LEDGER_COMMANDS,
  LEDGER_SCHEMA_STEPS,
  type TxPortRegistration,
  type WriterRegistration,
} from "../../../packages/core/storage/ledger/mod.ts";
import { readKey } from "../../../packages/core/storage/ledger/reads.ts";
import type {
  LedgerTestRegistration,
  LedgerTestRegistrationModule,
  TestBoot,
} from "./ledger-types.ts";

export function credentialMap(initial: readonly AuthenticatedContext[]) {
  const current = new Map<string, AuthenticatedContext>();
  function set(ctx: AuthenticatedContext): Result<void> {
    const parsed = authenticatedContextSchema.safeParse(ctx);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: "테스트 credential이 올바르지 않다",
      });
    }
    current.set(parsed.data.credential_ref, structuredClone(parsed.data));
    return ok(undefined);
  }
  for (const ctx of initial) {
    const result = set(ctx);
    if (!result.ok) throw new Error("invalid initial credential");
  }
  return {
    set,
    revoke: (ref: string) => current.delete(ref),
    get(ref: string): Result<AuthenticatedContext> {
      const ctx = current.get(ref);
      return ctx
        ? ok(structuredClone(ctx))
        : err({ code: "unauthorized", message: "현재 credential이 없다" });
    },
  };
}

export async function assemble(boot: TestBoot) {
  const credentials = credentialMap(boot.credentials);
  const registrations: LedgerTestRegistration[] = [];
  for (const url of boot.modules) {
    const module: LedgerTestRegistrationModule = await import(url);
    const registration = module.createLedgerTestRegistration({
      currentCredential: (ref) => credentials.get(ref),
    });
    if (
      !registration || typeof registration !== "object" ||
      "then" in registration
    ) {
      throw new Error("invalid registration");
    }
    registrations.push(registration);
  }
  const clock = one("clock") ?? manualClock(boot.nowMs);
  const random = seededRandom(boot.seed + 1);
  const confirmationRegistry = new ConfirmationRegistry({
    clock,
    random: (bytes) => random.fill(bytes),
  });
  const confirmation = confirmationBridge(confirmationRegistry);
  const ids = one("ids") ??
    createIdSource({ clock, random: seededRandom(boot.seed) });
  const blob = one("registerBlobRef");
  function one<K extends "clock" | "ids" | "registerBlobRef">(key: K) {
    const values = registrations.flatMap((r) =>
      r[key] === undefined ? [] : [r[key]!]
    );
    if (values.length > 1) throw new Error("duplicate singleton registration");
    return values[0];
  }
  const steps: SchemaStep[] = [...LEDGER_SCHEMA_STEPS];
  const commands: CommandDefinition[] = [...LEDGER_COMMANDS];
  const reads = new Map<
    string,
    { read: ReadDefinition; ports: ReadonlyMap<unknown, unknown> }
  >();
  const ports: TxPortRegistration[] = [];
  const schemaIds = new Set(steps.map((s) => s.id));
  const commandNames = new Set(commands.map((d) => d.route.name));
  const paths = new Set(commands.map((d) => routePath(d.route)));
  for (const registration of registrations) {
    for (const step of registration.schemaSteps ?? []) {
      if (schemaIds.has(step.id)) {
        throw new Error("duplicate schema registration");
      }
      schemaIds.add(step.id);
      steps.push(step);
    }
    for (
      const definition of [
        ...registration.commands ?? [],
        ...registration.testCommands ?? [],
      ]
    ) {
      const path = routePath(definition.route);
      if (commandNames.has(definition.route.name) || paths.has(path)) {
        throw new Error("duplicate command registration");
      }
      commandNames.add(definition.route.name);
      paths.add(path);
      commands.push(definition);
    }
    for (const read of registration.reads ?? []) {
      const key = readKey(read.route);
      const path = routePath(read.route);
      if (reads.has(key) || paths.has(path)) {
        throw new Error("duplicate read registration");
      }
      paths.add(path);
      reads.set(key, { read, ports: registration.readPorts ?? new Map() });
    }
    ports.push(...registration.ports ?? []);
  }
  function checkCredential(
    claim: AuthenticatedContext,
  ): Result<AuthenticatedContext> {
    const found = credentials.get(claim.credential_ref);
    if (!found.ok) return found;
    const ctx = found.value;
    if (ctx.principal !== claim.principal || ctx.actor !== claim.actor) {
      return err({
        code: "forbidden",
        message: "현재 credential binding이 다르다",
      });
    }
    if (
      ctx.expires_at !== undefined &&
      Date.parse(ctx.expires_at) <= clock.nowMs()
    ) {
      return err({
        code: "unauthorized",
        message: "현재 credential이 만료됐다",
      });
    }
    const submittedRun = (claim as RequestContext).run;
    if (
      (claim.conditions?.run !== undefined &&
        claim.conditions.run !== ctx.conditions.run) ||
      (submittedRun !== undefined && ctx.conditions.run !== undefined &&
        submittedRun !== ctx.conditions.run)
    ) {
      return err({ code: "forbidden", message: "현재 run 조건이 다르다" });
    }
    return found;
  }
  let active: { tx: Tx; ctx: RequestContext } | undefined;
  const writer: WriterRegistration = {
    commands: commands.map((definition) => ({
      ...definition,
      handle(tx, ctx, input, compare) {
        // handler가 받은 context를 바꿔도 blob 검사에는 current snapshot을 준다.
        active = { tx, ctx: structuredClone(ctx) };
        try {
          return definition.handle(tx, ctx, input, compare);
        } finally {
          active = undefined;
        }
      },
    })),
    clock,
    ids,
    ports,
    checkCredential,
    confirmation,
    registerBlobRef: (reference) =>
      active && blob
        ? blob(active.tx, structuredClone(active.ctx), reference)
        : err({ code: "unavailable", message: "테스트 blob callback이 없다" }),
    // Tx.call은 writer executor가 등록 표로 dispatch한다. 이 stub은 실행기가 쓰지 않는다.
    call: () =>
      err({ code: "unavailable", message: "Tx.call은 실행기가 dispatch한다" }),
  };
  return {
    credentials,
    clock,
    steps,
    reads,
    writer,
    checkCredential,
    confirmation: confirmationRegistry,
  };
}
