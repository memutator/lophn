// coding agent connection credential의 core 조립(platform#T34, identity#R5·R15, secrets#R12).
// 인증 경계(packages/platform/identity의 authority)에 ledger의 connection 현재 상태 읽기와 OS
// keychain을 이어 주고, 인증된 coding context를 ledger credential 기록에 남기며, 시작 때 active
// connection 색인과 중단 고아 정리를 비치명적으로 맞춘다. keychain adapter는 호출자가 준다:
// 제품 main만 OS adapter를 주고, 시험은 fake를 주므로 사람의 실제 keychain에 닿지 않는다.
import {
  type Clock,
  createIdSource,
  err,
  type RandomSource,
  type Result,
} from "../../packages/base/mod.ts";
import {
  listConnections,
  lookupConnectionAuth,
} from "../../packages/coding-agent/mod.ts";
import type {
  AuthenticatedContext,
} from "../../packages/contracts/platform/mod.ts";
import {
  type CodingCredentialAuthority,
  createCodingCredentialAuthority,
  type CredentialRegistry,
} from "../../packages/platform/identity/mod.ts";
import { openConnection } from "../../packages/platform/ledger/mod.ts";
import {
  createCodingCredentialKeychain,
  type KeychainAdapter,
} from "../../packages/platform/secrets/mod.ts";

export type CodingCredentials = {
  readonly authority: CodingCredentialAuthority;
  // 사람의 연결 결정을 받는 입구가 부른다(입구의 contract는 coding-agent 소유). submit은 그 입구가
  // 사람 credential로 connection create command를 보내는 함수다. 성공하면 인증된 context를 ledger
  // credential 기록에 남긴다.
  connect: CodingCredentialAuthority["connect"];
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
