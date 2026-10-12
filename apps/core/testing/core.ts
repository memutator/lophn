/**
 * 다른 팀의 *_test.ts가 쓰는 test-only public entry. 제품 main.ts에는 없다.
 *
 * 임시 데이터 root로 core 전체를 띄우고, 다섯 actor 어느 것이든 지정 scope·
 * conditions의 테스트 credential을 만든다. 제품 registry는 user·machine만
 * 발급하므로, agent·app·coding_agent는 테스트 전용 기록으로만 심는다.
 */
import {
  createIdSource,
  type ManualClock,
  manualClock,
  seededRandom,
} from "../../../packages/base/mod.ts";
import type { Result } from "../../../packages/base/mod.ts";
import { err, ok } from "../../../packages/base/mod.ts";
import type {
  ActorKind,
  AuthenticatedContext,
  CredentialConditions,
  CredentialScope,
} from "../../../packages/protocol/platform/mod.ts";
import {
  actorSchema,
  authenticatedContextSchema,
} from "../../../packages/protocol/platform/mod.ts";
import type { PreparedBlob } from "../../../packages/protocol/platform/mod.ts";
import { type Core, startCore } from "../core.ts";
import type { AppsControl } from "../apps-control.ts";
import type { ProcessSource } from "../../../packages/core/apps/runtime/connect.ts";
import type { DesiredApp } from "../../../packages/core/apps/runtime/supervisor/mod.ts";
import type {
  PreviewBundles,
  PreviewReleases,
} from "../../../packages/core/apps/preview/service.ts";
import type { TeamModule } from "../registration.ts";
import type { CodingCredentials } from "../coding-credential.ts";
import type { KeychainAdapter } from "../../../packages/core/secrets/mod.ts";

export type CoreHarnessCredential = {
  actor: ActorKind;
  principal: string;
  scope: CredentialScope;
  conditions: CredentialConditions;
  // 자격의 기한. 없으면 기한이 없다.
  expires_at?: string;
};

export type CoreHarnessOptions = {
  teams?: readonly TeamModule[];
  teamModules?: readonly string[];
  nowMs?: number;
  seed?: number;
  // I/O worker를 띄운다. 글·본문을 blob으로 준비하는 command(approval 설명 글 등)를 시험할 때 켠다.
  io?: boolean;
  // apps 제어를 시험한다. supervisor를 실제로 띄우거나(supervisor), 프로세스 관측을 바꿔 끼운다.
  // 실제 coding credential 발급·인증을 켠다(fake keychain은 호출자가 준다). 사람의 실제 keychain은
  // 열지 않는다.
  coding?: { keychain: KeychainAdapter; loaders?: readonly string[] };
  apps?: {
    supervisor?: boolean | { runtimeDir?: string };
    process?: ProcessSource;
    sweepMs?: number;
    // preview가 bundle·release를 여는 자리와 nonce(apps/preview 시험).
    previews?: {
      bundles?: PreviewBundles;
      releases?: PreviewReleases;
      nonce?: () => string;
    };
  };
};

export type CoreHarness = {
  port: number;
  epoch: string;
  dataRoot: string;
  credential(
    input: CoreHarnessCredential,
  ): Promise<Result<{ token: string; context: AuthenticatedContext }>>;
  // 준비 참조를 writer 메모리에 심는다. I/O worker 없이 등록 경로를 시험할 때 쓴다.
  notePrepared(prepared: PreparedBlob, nowMs: number): Promise<Result<void>>;
  // 신뢰 프로세스의 blob 준비 호출이다. 실제 I/O worker가 바이트를 저장한다(`io: true`).
  prepareBlob: Core["prepareBlob"];
  // `coding`을 켠 core의 credential 발급 입구와 준비 완료 신호.
  codingCredentials?: CodingCredentials;
  codingCredentialsReady?: Promise<void>;
  // 테스트 시계. advance 뒤 sweepTicketClaims를 부르면 만료 정리를 기다리지 않는다.
  clock: ManualClock;
  // 만료·회수 claim을 한 번 정리한다. 60초 timer와 같은 함수다.
  sweepTicketClaims(): Promise<void>;
  // 기한에 도달한 대기 approval request를 한 번 만료로 확정한다. 60초 timer와 같은 함수다.
  sweepApprovalExpiry(): Promise<void>;
  // 원하는 앱 프로세스 상태를 apps supervisor에 알린다.
  reconcileApp(desired: DesiredApp): Promise<Result<void>>;
  // apps 제어(connect 어댑터·supervisor 질의). 시험이 sweep을 직접 돌린다.
  appsControl: AppsControl;
  // 확인 창 handle을 writer registry에 발급한다. confirmation route 시험에 쓴다.
  confirmation(body: {
    action: "issue" | "close-window" | "clear";
    request?: unknown;
    windowId?: string;
  }): Promise<Result<unknown>>;
  close(): Promise<void>;
};

type RecordingCore = Core & {
  record(context: AuthenticatedContext): Promise<Result<void>>;
  acceptTestCredential?(
    context: AuthenticatedContext,
    token: string,
  ): Promise<Result<void>>;
};

export async function createCoreHarness(
  options: CoreHarnessOptions = {},
): Promise<Result<CoreHarness>> {
  // ULID 시각은 48bit다. 2026년은 그 범위를 넘으므로 기본 시계를 그 안에 둔다.
  const nowMs = options.nowMs ?? Date.UTC(2024, 0, 1);
  const seed = options.seed ?? 1;
  const clock = manualClock(nowMs);
  const directory = await Deno.makeTempDir({ prefix: "lophn-core-harness-" });
  const started = await startCore({
    lophnHome: directory,
    port: 0,
    teams: options.teams ?? [],
    teamModules: options.teamModules,
    clock,
    random: seededRandom(seed),
    testCredentials: true,
    superviseIo: options.io === true,
    ...(options.coding
      ? {
        codingKeychain: options.coding.keychain,
        codingLoaders: options.coding.loaders ?? [],
      }
      : {}),
    ...(options.apps?.supervisor
      ? { appSupervisor: options.apps.supervisor }
      : {}),
    ...(options.apps?.process ? { appProcess: options.apps.process } : {}),
    ...(options.apps?.sweepMs === undefined
      ? {}
      : { appsSweepMs: options.apps.sweepMs }),
    ...(options.apps?.previews ? { appPreviews: options.apps.previews } : {}),
  });
  if (!started.ok) {
    await Deno.remove(directory, { recursive: true });
    return started;
  }
  const core = started.value as RecordingCore;
  const random = seededRandom(seed + 7);
  const ids = createIdSource({ clock, random });
  let sequence = 0;
  let closing: Promise<void> | undefined;
  return ok({
    port: core.port,
    epoch: core.epoch,
    dataRoot: core.dataRoot,
    async credential(input) {
      const built = buildContext(input, ids, sequence++);
      if (!built.ok) return built;
      const token = tokenOf(random);
      if (!core.acceptTestCredential) {
        return err({
          code: "unavailable",
          message: "테스트 credential 입구가 없다",
        });
      }
      const accepted = await core.acceptTestCredential(built.value, token);
      if (!accepted.ok) return accepted;
      const recorded = await core.record(built.value);
      if (!recorded.ok) return recorded;
      return ok({ token, context: built.value });
    },
    async notePrepared(prepared, nowMs) {
      if (!core.notePrepared) {
        return err({ code: "unavailable", message: "준비 참조 입구가 없다" });
      }
      return await core.notePrepared(prepared, nowMs);
    },
    prepareBlob: (call) => core.prepareBlob(call),
    ...(core.codingCredentials
      ? {
        codingCredentials: core.codingCredentials,
        codingCredentialsReady: core.codingCredentialsReady,
      }
      : {}),
    clock,
    sweepTicketClaims: () => core.sweepTicketClaims(),
    sweepApprovalExpiry: () => core.sweepApprovalExpiry(),
    reconcileApp: (desired) => core.reconcileApp(desired),
    appsControl: core.appsControl!,
    async confirmation(body) {
      if (!core.confirmation) {
        return err({ code: "unavailable", message: "확인 발급 입구가 없다" });
      }
      return await core.confirmation(body);
    },
    // 여러 번 불러도 한 번만 끝낸다. shutdown이 던져도 데이터 root는 지운다.
    close() {
      return closing ??= (async () => {
        try {
          await core.shutdown();
        } finally {
          await Deno.remove(directory, { recursive: true });
        }
      })();
    },
  });
}

function buildContext(
  input: CoreHarnessCredential,
  ids: { newId(prefix: string): string },
  sequence: number,
): Result<AuthenticatedContext> {
  // actor id는 "cac_<ulid>" 전체다. 접두사를 떼면 schema를 통과하지 못한다.
  const actor = input.actor === "user" || input.actor === "machine"
    ? input.actor
    : `${input.actor}:${ids.newId(prefixOf(input.actor))}`;
  if (!actorSchema.safeParse(actor).success) {
    return err({
      code: "invalid_input",
      message: "테스트 actor가 올바르지 않다",
    });
  }
  const parsed = authenticatedContextSchema.safeParse({
    principal: input.principal,
    actor,
    scope: input.scope,
    conditions: input.conditions,
    credential_ref: `test-${sequence}`,
    ...(input.expires_at === undefined ? {} : { expires_at: input.expires_at }),
  });
  if (!parsed.success) {
    return err({
      code: "invalid_input",
      message: "테스트 credential이 올바르지 않다",
    });
  }
  return ok(parsed.data);
}

function prefixOf(actor: ActorKind): string {
  if (actor === "coding_agent") return "cac";
  if (actor === "agent") return "asg";
  return "app";
}

function tokenOf(random: { fill(bytes: Uint8Array): void }): string {
  const bytes = new Uint8Array(32);
  random.fill(bytes);
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll(
    "/",
    "_",
  ).replaceAll("=", "");
}
