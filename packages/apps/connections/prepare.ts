// 앱 쌍 연결 준비(apps/connections#R1–R7, apps/runtime#R30). source 앱 자식이 broker로 요청하면
// source의 현재 프로세스·선언·grant와 target의 현재 프로세스를 읽어 교집합 범위의 AppConnection을
// 서명한다. ledger queue를 거치지 않는 현재 사실 조회뿐이고 업무 payload는 중계하지 않는다.
// 범위 밖 대상은 없는 앱과 같은 not_found다. 신원은 broker의 자식 연결이 정하며 본문 주장은 없다.
import { type Clock, err, ok, type Result } from "../../base/mod.ts";
import {
  type AppConnection,
  appConnectionSchema,
} from "../../protocol/apps/mod.ts";
import type {
  ConnectFacts,
  CoreSigner,
  ProcessObservation,
  ProcessSource,
} from "../runtime/mod.ts";
import { createPathBook, type PathBook } from "./origin.ts";
import { type PairDeclaration, pairScope, resolveCall } from "./resolve.ts";

// 연결 한 번의 기한 상한이다(apps Q5). 원래 자식 프로세스가 끝나면 nonce가 달라져 쓰지 못한다.
export const PAIR_CONNECTION_TTL_MS = 10 * 60_000;
export const PAIR_ISSUED_LIMIT = 4096;

export type PairSource = {
  app: string;
  release: string | null;
  mode: "live" | "preview" | "test";
  processNonce: string;
};

export type PairDeclarations = {
  release: string;
  app_connections: readonly PairDeclaration[];
};

export type PairFacts = ConnectFacts & {
  // 앱의 현재 release 선언. release가 없으면 null이다.
  declarations(app: string): Promise<Result<PairDeclarations | null>>;
};

export type PairDeps = {
  clock: Clock;
  signer: CoreSigner;
  process: ProcessSource;
  facts: PairFacts;
  paths?: PathBook;
  ttlMs?: number;
};

export type PairRequest = {
  source: PairSource;
  app: string;
  commands: readonly string[];
  parent_invocation: string | null;
  // 처리 중인 호출이 다른 앱에게서 받은 것이면 그 출처의 식별(path는 서비스가 정한다).
  incoming?: {
    app: string;
    release: string;
    parent_invocation: string | null;
  };
};

export type PairConnection = {
  endpoint: string;
  connection: AppConnection;
  signature: string;
};

export type Inspected = {
  source: ProcessObservation;
  target: ProcessObservation;
  commands: string[];
  grant: string;
};

function absent(): Result<never> {
  return err({ code: "not_found", message: "app not found" });
}

function unavailable(message: string): Result<never> {
  return err({ code: "unavailable", message });
}

function runningLive(
  found: ProcessObservation | undefined,
): found is ProcessObservation {
  return found !== undefined && found.mode === "live" && found.ready &&
    found.accepting && found.release !== null;
}

// 연결을 열기 전 현재 사실의 검사다. 준비와 confirm proof 발급이 같은 판정을 쓴다.
export async function inspectPair(
  deps: Pick<PairDeps, "process" | "facts">,
  request: Pick<PairRequest, "source" | "app" | "commands">,
): Promise<Result<Inspected>> {
  const { source } = request;
  if (source.mode !== "live" || source.release === null) {
    return err({
      code: "forbidden",
      message: "app connections are live only",
    });
  }
  // 옛 프로세스·교체된 release의 요청은 현재 자식이 아니라서 거절한다.
  const own = await deps.process.current({ app: source.app, mode: "live" });
  if (!own.ok) return own;
  if (
    own.value === undefined ||
    own.value.processNonce !== source.processNonce ||
    own.value.release !== source.release
  ) {
    return err({
      code: "unauthorized",
      message: "source process is not current",
    });
  }
  if (!runningLive(own.value)) return unavailable("source app is not running");
  const app = await deps.facts.app(source.app);
  if (!app.ok) return app;
  if (app.value === null) {
    return err({ code: "unauthorized", message: "source app is unknown" });
  }
  if (app.value.status !== "active" || !app.value.run_enabled) {
    return unavailable("source app execution is stopped");
  }
  if (app.value.active_release !== source.release) {
    return err({ code: "conflict", message: "source release changed" });
  }
  const declared = await deps.facts.declarations(source.app);
  if (!declared.ok) return declared;
  if (declared.value === null || declared.value.release !== source.release) {
    return err({ code: "conflict", message: "source release changed" });
  }
  const grants = await deps.facts.grants(source.app);
  if (!grants.ok) return grants;
  const pair = {
    source: source.app,
    target: request.app,
    declared: declared.value.app_connections,
    grants: grants.value,
  };
  // 선언∩grant가 없는 대상은 없는 앱과 같다. 대상의 실행 상태를 보기 전에 답한다.
  if (pairScope(pair).length === 0) return absent();

  const target = await deps.facts.app(request.app);
  if (!target.ok) return target;
  if (target.value === null) return absent();
  if (
    target.value.status !== "active" || !target.value.run_enabled ||
    target.value.active_release === null
  ) {
    return unavailable("target app is not available");
  }
  const live = await deps.process.current({ app: request.app, mode: "live" });
  if (!live.ok) return live;
  if (
    !runningLive(live.value) ||
    live.value.release !== target.value.active_release
  ) {
    return unavailable("target app is not available");
  }
  const resolved = resolveCall({
    ...pair,
    targetCommands: live.value.commands,
    requested: request.commands,
  });
  if (resolved.kind === "absent") return absent();
  if (resolved.kind === "denied") {
    return err({
      code: "forbidden",
      message: "app.call is not permitted for these commands",
      details: {
        permission: "app.call",
        scope: { app: request.app, commands: [...request.commands].sort() },
      },
    });
  }
  return ok({
    source: own.value,
    target: live.value,
    commands: resolved.commands,
    grant: resolved.grant,
  });
}

export type PairPreparer = {
  prepare(request: PairRequest): Promise<Result<PairConnection>>;
  // 그 앱이 source이거나 target인 발급 연결을 새 호출부터 막는다(ConnectionGate 구현).
  // 이미 가던 요청은 취소하지 않고 같은 nonce의 새 준비를 거절한다.
  close(app: string): void;
  readonly paths: PathBook;
  readonly issued: number;
};

export function createPairPreparer(deps: PairDeps): PairPreparer {
  const ttl = deps.ttlMs ?? PAIR_CONNECTION_TTL_MS;
  const paths = deps.paths ?? createPathBook(deps.clock);
  const issued: {
    sourceApp: string;
    sourceNonce: string;
    targetApp: string;
    targetNonce: string;
    expiresAtMs: number;
  }[] = [];
  // 연결을 만들 때 본 프로세스의 현재 nonce. close가 막을 대상을 정한다.
  const seen = new Map<string, string>();
  const closed = new Set<string>();

  function prune(nowMs: number): void {
    for (let index = issued.length - 1; index >= 0; index--) {
      if (issued[index].expiresAtMs <= nowMs) issued.splice(index, 1);
    }
  }

  return {
    paths,
    get issued() {
      prune(deps.clock.nowMs());
      return issued.length;
    },
    close(app) {
      for (const record of issued) {
        if (record.sourceApp === app) {
          closed.add(`${app}/${record.sourceNonce}`);
        }
        if (record.targetApp === app) {
          closed.add(`${app}/${record.targetNonce}`);
        }
      }
      const nonce = seen.get(app);
      if (nonce !== undefined) closed.add(`${app}/${nonce}`);
    },
    async prepare(request) {
      const { source } = request;
      if (closed.has(`${source.app}/${source.processNonce}`)) {
        return unavailable("connections are closing");
      }
      const found = await inspectPair(deps, request);
      if (!found.ok) return found;
      const { target } = found.value;
      if (closed.has(`${request.app}/${target.processNonce}`)) {
        return unavailable("connections are closing");
      }
      const nowMs = deps.clock.nowMs();
      const origin = paths.next({
        source: {
          app: source.app,
          release: source.release as string,
          processNonce: source.processNonce,
        },
        target: request.app,
        grant: found.value.grant,
        parent: request.parent_invocation,
        ...(request.incoming === undefined ? {} : {
          incoming: {
            app: request.incoming.app,
            release: request.incoming.release,
            parent: request.incoming.parent_invocation,
          },
        }),
      });
      if (!origin.ok) return origin;
      // 읽는 동안 source나 target이 교체됐으면 옛 사실로 서명하지 않는다.
      const again = await inspectPair(deps, request);
      if (!again.ok) return again;
      if (
        again.value.target.processNonce !== target.processNonce ||
        again.value.target.release !== target.release
      ) {
        return err({
          code: "conflict",
          message: "target app was replaced while preparing",
        });
      }
      const expiresAtMs = nowMs + ttl;
      const connection = appConnectionSchema.safeParse({
        app: request.app,
        release: target.release,
        bundle_hash: target.bundleHash,
        mode: "live",
        process_nonce: target.processNonce,
        actor: `app:${source.app}`,
        credential_ref: `app-call:${source.processNonce}`,
        screens: [],
        screen_sizes: {},
        caller: origin.value,
        commands: found.value.commands,
        expires_at: new Date(expiresAtMs).toISOString(),
      });
      if (!connection.success) {
        return err({
          code: "invalid_input",
          message: "connection does not match its mode, screens, or caller",
        });
      }
      prune(nowMs);
      if (issued.length >= PAIR_ISSUED_LIMIT) {
        return unavailable("too many open connections");
      }
      const signed = await deps.signer.signConnection(connection.data);
      seen.set(source.app, source.processNonce);
      seen.set(request.app, target.processNonce);
      paths.issued(target, origin.value, expiresAtMs);
      issued.push({
        sourceApp: source.app,
        sourceNonce: source.processNonce,
        targetApp: request.app,
        targetNonce: target.processNonce,
        expiresAtMs,
      });
      return ok({
        endpoint: target.endpoint,
        connection: connection.data,
        signature: signed.signature,
      });
    },
  };
}
