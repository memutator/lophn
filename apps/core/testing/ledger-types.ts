import type { Clock, IdSource, Result } from "../../../packages/base/mod.ts";
import type {
  AuthenticatedContext,
  BlobRefRegistration,
  CommandDefinition,
  PermanentBlobReference,
  ReadDefinition,
  ReadRoute,
  RequestContext,
  SchemaStep,
  SqlParam,
  SqlRow,
  Tx,
} from "../../../packages/contracts/platform/mod.ts";
import type {
  CommandEnvelope,
  CommandSuccess,
  StoredCommandResult,
  TxPortRegistration,
} from "../../../packages/platform/ledger/mod.ts";

export type LedgerTestEnvironment = {
  currentCredential(credentialRef: string): Result<AuthenticatedContext>;
};

export type LedgerTestRegistration = {
  schemaSteps?: readonly SchemaStep[];
  // command 이름별 run 판정 표시. ledger가 감사 보완과 gate 밖 쓰기를 구분한다.
  runMarks?: Readonly<Record<string, { audit?: boolean; skip?: boolean }>>;
  commands?: readonly CommandDefinition[];
  testCommands?: readonly CommandDefinition[];
  reads?: readonly ReadDefinition[];
  ports?: readonly TxPortRegistration[];
  readPorts?: ReadonlyMap<unknown, unknown>;
  clock?: Clock;
  ids?: IdSource;
  registerBlobRef?: (
    tx: Tx,
    ctx: RequestContext,
    reference: BlobRefRegistration,
  ) => Result<PermanentBlobReference>;
};

export type LedgerTestRegistrationModule = {
  createLedgerTestRegistration(
    environment: LedgerTestEnvironment,
  ): LedgerTestRegistration;
};

export type LedgerHarnessOptions = {
  registrationModules: readonly URL[];
  credentials?: readonly AuthenticatedContext[];
  nowMs?: number;
  seed?: number;
};

export type LedgerHarness = {
  command(
    ctx: AuthenticatedContext,
    envelope: CommandEnvelope,
  ): Promise<Result<CommandSuccess>>;
  confirmation(body: {
    action: "issue" | "close-window" | "clear";
    request?: unknown;
    windowId?: string;
  }): Promise<Result<unknown>>;
  read(
    route: Pick<ReadRoute, "resource" | "method">,
    ctx: RequestContext,
    input: unknown,
  ): Promise<Result<unknown>>;
  readResult(
    ctx: AuthenticatedContext,
    key: string,
  ): Promise<Result<StoredCommandResult | null>>;
  setCredential(ctx: AuthenticatedContext): Promise<Result<void>>;
  revokeCredential(credentialRef: string): Promise<Result<void>>;
  inspect(
    query: string,
    params?: readonly SqlParam[],
  ): Promise<Result<SqlRow[]>>;
  probeWrite(query: string, params?: readonly SqlParam[]): Promise<
    Result<{
      changes: number | bigint;
      lastInsertRowid: number | bigint;
    }>
  >;
  close(): Promise<void>;
};

export type TestBoot = {
  path: string;
  modules: string[];
  credentials: readonly AuthenticatedContext[];
  nowMs: number;
  seed: number;
  role: "writer" | "reader";
};

export type TestRequest =
  & {
    id: number;
  }
  & (
    | { op: "command"; ctx: AuthenticatedContext; envelope: CommandEnvelope }
    | { op: "read-result"; ctx: AuthenticatedContext; key: string }
    | {
      op: "read";
      ctx: RequestContext;
      route: Pick<ReadRoute, "resource" | "method">;
      input: unknown;
    }
    | { op: "set-credential"; ctx: AuthenticatedContext }
    | { op: "revoke-credential"; credentialRef: string }
    | {
      op: "inspect" | "probe-write";
      query: string;
      params: readonly SqlParam[];
    }
    | { op: "close" }
    | {
      op: "confirmation";
      action: "issue" | "close-window" | "clear";
      request?: unknown;
      windowId?: string;
    }
  );
export type TestResponse = { id: number; result: Result<unknown> };
export type TestRequestBody = TestRequest extends infer R
  ? R extends TestRequest ? Omit<R, "id"> : never
  : never;
