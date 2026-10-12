// coding agent connection credential의 core 조립(platform#T34, identity#R5·R15, secrets#R12).
// 인증 경계(packages/platform/identity의 authority)에 ledger의 connection 현재 상태 읽기와 OS
// keychain을 이어 주고, 인증된 coding context를 ledger credential 기록에 남기며, 시작 때 active
// connection 색인과 중단 고아 정리를 비치명적으로 맞춘다. keychain adapter는 호출자가 준다:
// 제품 main만 OS adapter를 주고, 시험은 fake를 주므로 사람의 실제 keychain에 닿지 않는다.
import {
  type Clock,
  createIdSource,
  err,
  ok,
  type RandomSource,
  type Result,
} from "../../../base/mod.ts";
import {
  listConnections,
  lookupConnectionAuth,
} from "../../../coding-agent/mod.ts";
import {
  connectionConnectInputSchema,
  connectionCreate,
  connectionEndChildInputSchema,
  connectionEndConnectionInputSchema,
  connectionIdSchema,
  connectionRegisterChildInputSchema,
  connectionRevoke,
} from "../../../protocol/coding-agent/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import type { MemoryHandler } from "../mod.ts";
import type { Writer } from "../../storage/ledger/mod.ts";
import {
  type CodingCredentialAuthority,
  codingExternalCredential,
  createCodingCredentialAuthority,
  type CredentialRegistry,
} from "./mod.ts";
import { openConnection } from "../../storage/ledger/mod.ts";
import {
  createCodingCredentialKeychain,
  type KeychainAdapter,
} from "../../secrets/mod.ts";

const CODING_REF_PREFIX = "coding:";

export type CodingCredentials = {
  readonly authority: CodingCredentialAuthority;
  // 사람의 연결 결정을 받는 입구가 부른다(입구의 contract는 coding-agent 소유). submit은 그 입구가
  // 사람 credential로 connection create command를 보내는 함수다. 성공하면 인증된 context를 ledger
  // credential 기록에 남긴다.
  connect: CodingCredentialAuthority["connect"];
  // 신뢰 감독(shell main)이 TUI 아래 MCP·CLI child를 등록한다. scope는 ledger의 connection 현재 상태에서
  // 읽고, active가 아니거나 없는 connection은 등록하지 않는다. loader가 설치 목록 밖이면 forbidden이다.
  registerChild(input: {
    connection: string;
    process_generation: string;
    loader_identity: string;
  }): Result<void>;
  // `coding:<connection>` credential_ref의 지금 상태다. ledger의 connection 상태를 읽으므로 회수된
  // connection은 바로 거절이고 coding credential이 아닌 ref는 undefined다.
  current(
    credentialRef: string,
  ): Result<AuthenticatedContext> | undefined;
  // registry·기록 함수가 준비된 뒤 한 번 부른다. 고아 정리와 색인 복원을 하고 실패는 기동을 막지
  // 않는다(진단 log만 남긴다). 끝나면 resolve한다.
  start(
    registry: CredentialRegistry,
    record: (context: AuthenticatedContext) => Promise<Result<void>>,
  ): Promise<void>;
};

export function createCodingCredentials(options: {
  ledgerPath: string;
  dataRoot: string;
  keychain: KeychainAdapter;
  clock: Clock;
  random: RandomSource;
  // 설치된 보호 loader의 identity 목록. 비면 어떤 child도 등록되지 않는다.
  loaders: readonly string[];
}): CodingCredentials {
  // 인증 port: 요청마다 ledger의 현재 connection 상태를 새 읽기 연결로 읽는다.
  const auth = (principal: string) => {
    const opened = openConnection(options.ledgerPath);
    if (!opened.ok) throw new Error("ledger unreadable");
    try {
      return Promise.resolve(lookupConnectionAuth(opened.value.sql, principal));
    } finally {
      opened.value.close();
    }
  };
  const authority = createCodingCredentialAuthority({
    random: options.random,
    ids: createIdSource({ clock: options.clock, random: options.random }),
    vault: createCodingCredentialKeychain({ keychain: options.keychain }),
    auth,
    loaders: options.loaders,
  });
  let bound:
    | {
      registry: CredentialRegistry;
      record: (context: AuthenticatedContext) => Promise<Result<void>>;
    }
    | undefined;

  // active connection의 현재 인증 context를 ledger credential 기록에 남긴다.
  async function recordContext(connection: string): Promise<Result<void>> {
    if (bound === undefined) {
      return err({
        code: "unavailable",
        message: "credential 기록 준비 전이다",
      });
    }
    const credential = await authority.credentialFor(connection);
    if (credential === undefined) {
      return err({
        code: "unavailable",
        message: "active connection이 아니다",
      });
    }
    const context = bound.registry.externalContext(credential);
    return context.ok ? await bound.record(context.value) : context;
  }

  function activeConnections(): string[] {
    const opened = openConnection(options.ledgerPath);
    if (!opened.ok) throw new Error("ledger unreadable");
    try {
      const listed = listConnections(opened.value.sql, { state: "active" });
      if (!listed.ok) throw new Error("connection list unreadable");
      return listed.value.map((connection) => connection.id);
    } finally {
      opened.value.close();
    }
  }

  return {
    authority,
    registerChild(input) {
      const opened = openConnection(options.ledgerPath);
      if (!opened.ok) {
        return err({ code: "unavailable", message: "ledger unreadable" });
      }
      try {
        const found = lookupConnectionAuth(
          opened.value.sql,
          `coding_agent:${input.connection}`,
        );
        if (found === undefined || found.state !== "active") {
          // 없는 connection·회수된 connection은 같은 답이다.
          return err({
            code: "forbidden",
            message: "loader child를 등록할 수 없다",
          });
        }
        return authority.registerChild({ ...input, scope: found.scope });
      } finally {
        opened.value.close();
      }
    },
    current(credentialRef) {
      if (!credentialRef.startsWith(CODING_REF_PREFIX)) return undefined;
      const connection = connectionIdSchema.safeParse(
        credentialRef.slice(CODING_REF_PREFIX.length),
      );
      if (!connection.success) return undefined;
      const denied = err(
        {
          code: "unauthorized",
          message: "현재 credential이 없다",
        } as const,
      );
      if (bound === undefined) return denied;
      const opened = openConnection(options.ledgerPath);
      if (!opened.ok) return denied;
      try {
        const found = lookupConnectionAuth(
          opened.value.sql,
          `coding_agent:${connection.data}`,
        );
        if (found === undefined || found.state !== "active") return denied;
        const context = bound.registry.externalContext(
          codingExternalCredential(connection.data, found.scope),
        );
        return context.ok ? context : denied;
      } finally {
        opened.value.close();
      }
    },
    async connect(input, submit, signal) {
      const connected = await authority.connect(input, submit, signal);
      if (!connected.ok) return connected;
      // 기록하지 못해도 commit된 connection은 그대로다. 다음 시작의 start가 다시 기록한다.
      const recorded = await recordContext(connected.value.connection);
      if (!recorded.ok) {
        await note(options.dataRoot, options.clock.now(), "record");
      }
      return connected;
    },
    async start(registry, record) {
      bound = { registry, record };
      let ids: string[] = [];
      try {
        // 기록을 잃은 고아는 keychain의 고정 위치 목록으로 찾는다. 실패는 진단만 남긴다.
        await authority.recover();
      } catch {
        await note(options.dataRoot, options.clock.now(), "recover");
      }
      try {
        ids = activeConnections();
        await authority.restore(ids);
      } catch {
        await note(options.dataRoot, options.clock.now(), "restore");
        return;
      }
      for (const id of ids) {
        try {
          const recorded = await recordContext(id);
          if (!recorded.ok && recorded.error.code !== "unavailable") {
            await note(options.dataRoot, options.clock.now(), "record");
          }
        } catch {
          await note(options.dataRoot, options.clock.now(), "record");
        }
      }
    },
  };
}

// 비치명 실패의 diagnostics 기록. 기록 실패도 삼킨다. 원문·경로·hash·connection 참조는 넣지 않고
// 단계 분류만 남긴다.
async function note(dataRoot: string, at: string, step: string): Promise<void> {
  try {
    const directory = `${dataRoot}/logs`;
    try {
      await Deno.mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    }
    await Deno.writeTextFile(
      `${directory}/coding-credential.jsonl`,
      JSON.stringify({
        at,
        component: "platform/core",
        kind: "log",
        code: "lophn_internal",
        error_type: "coding_credential",
        location: "apps/core/coding-credential.ts",
        message: "Coding credential startup step did not finish.",
        step,
      }) + "\n",
      { append: true },
    );
  } catch {
    // 기록하지 못해도 core는 그대로 선다.
  }
}

// 사람의 연결 결정 입구의 처리기다(connection#R2). 사람 credential의 요청만 이 route에 닿는다
// (route actors가 user). 인증 경계가 token을 자동 발급해 keychain에 준비하고, 검증 hash만 같은 사람
// credential로 connection create command에 제출한다. 결과는 connection 참조뿐이다.
export function connectHandler(
  coding: Pick<CodingCredentials, "connect">,
  writer: () => Writer,
): MemoryHandler {
  return async (ctx, input) => {
    const parsed = connectionConnectInputSchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: "연결 이름 또는 범위가 올바르지 않다",
      });
    }
    const connected = await coding.connect(
      parsed.data,
      async (submission) => {
        const sent = await writer().command(ctx, {
          command: connectionCreate.name,
          input: submission,
          idempotency_key: `connect-${submission.id}`,
          compare: {},
          prepared: [],
        });
        return sent.ok ? ok(sent.value.result) : err(sent.error);
      },
    );
    return connected.ok
      ? ok({ connection: connected.value.connection })
      : connected;
  };
}

// 연결 회수가 commit되면 응답 전에 그 credential로 연 앱 통로를 바로 닫는다(connection#R8). 닫는 일은
// 앱 connector의 검사(회수된 credential의 connection이 연 프로세스 통로를 닫는다)이고, 1초 timer를
// 기다리지 않는다. 회수 결과는 닫는 일의 성패와 상관없이 그대로다.
export function withRevocationSweep(
  writer: Writer,
  sweep: () => Promise<unknown>,
  // 회수된 connection 참조를 받아 그 connection 아래 등록된 child를 닫는다.
  revoked?: (connection: string) => void,
): Writer {
  return {
    ...writer,
    async command(ctx, envelope) {
      const done = await writer.command(ctx, envelope);
      if (done.ok && envelope.command === connectionRevoke.name) {
        await sweep().catch(() => undefined);
        const connection = (envelope.input as { connection?: unknown })
          ?.connection;
        if (typeof connection === "string") revoked?.(connection);
      }
      return done;
    },
  };
}

// 신뢰 감독(shell main)의 child 등록·해제 입구의 처리기다(platform/identity#R15). route actors가 user라 사람
// credential의 요청만 닿고 coding_agent·app·agent는 route 앞에서 403이다. 결과에는 token·scope가 없다.
export function registerChildHandler(
  coding: Pick<CodingCredentials, "registerChild">,
): MemoryHandler {
  return (_ctx, input) => {
    const parsed = connectionRegisterChildInputSchema.safeParse(input);
    if (!parsed.success) {
      return Promise.resolve(err({
        code: "invalid_input",
        message: "child 등록 입력이 올바르지 않다",
      }));
    }
    const registered = coding.registerChild(parsed.data);
    return Promise.resolve(
      registered.ok ? ok({ registered: true }) : registered,
    );
  };
}

export function endChildHandler(
  coding: Pick<CodingCredentials, "authority">,
): MemoryHandler {
  return (_ctx, input) => {
    const parsed = connectionEndChildInputSchema.safeParse(input);
    if (!parsed.success) {
      return Promise.resolve(err({
        code: "invalid_input",
        message: "child 해제 입력이 올바르지 않다",
      }));
    }
    coding.authority.endChild(parsed.data.process_generation);
    return Promise.resolve(ok({}));
  };
}

export function endConnectionHandler(
  coding: Pick<CodingCredentials, "authority">,
): MemoryHandler {
  return (_ctx, input) => {
    const parsed = connectionEndConnectionInputSchema.safeParse(input);
    if (!parsed.success) {
      return Promise.resolve(err({
        code: "invalid_input",
        message: "connection 해제 입력이 올바르지 않다",
      }));
    }
    return Promise.resolve(
      ok({ ended: coding.authority.endConnection(parsed.data.connection) }),
    );
  };
}
