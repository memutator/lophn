// core 안 apps 제어 어댑터. `POST /v1/apps/connect`가 부르고 AppConnection을 서명한다.
// ledger queue 밖이다: supervisor의 현재 프로세스 관측(메모리)과 현재 App·Grant read를
// 읽어 원래 credential의 actor·scope·기한으로 제한한 connection을 만든다. endpoint·nonce는
// ledger에 쓰지 않는다. 본문의 actor·mode·effect·다른 앱 주장은 권한 근거가 아니다.
import { type Clock, err, ok, type Result } from "../../../base/mod.ts";
import {
  appConnect,
  type AppConnectInput,
  type AppConnection,
  appConnectionSchema,
  type AppGrant,
  type CallOrigin,
  type ChannelMode,
} from "../../../protocol/apps/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import type { CoreSigner } from "./signing.ts";

type ScreenSize = "full" | "panel" | "card";

// AppConnection 기한의 상한이다. 원래 credential의 기한이 더 짧으면 그 기한이다.
export const CONNECTION_TTL_MS = 10 * 60_000;
// 서명해서 내보낸 connection을 기억하는 수의 상한. 기한이 지난 것은 먼저 뺀다.
export const ISSUED_CONNECTION_LIMIT = 4096;

// supervisor가 지금 쥔 앱 프로세스 하나의 관측이다. 과거 event·ledger 주소로 만들지 않는다.
export type ProcessObservation = {
  app: string;
  mode: "live" | "preview";
  release: string | null;
  bundleHash: string;
  processNonce: string;
  // 앱 direct socket. 준비 전에도 supervisor는 안다. 공개 여부는 ready가 정한다.
  endpoint: string;
  ready: boolean;
  accepting: boolean;
  // 실제 프로세스가 등록한 command key(ReadyAttestation)와 선언한 화면·크기다.
  commands: readonly string[];
  screens: Readonly<Record<string, readonly ScreenSize[]>>;
};

export type ProcessQuery =
  | { app: string; mode: "live" }
  | { app: string; mode: "preview"; nonce: string };

export type ProcessSource = {
  // 없으면 값 없음이다. supervisor에 닿지 못하면 unavailable이다.
  current(
    query: ProcessQuery,
  ): Promise<Result<ProcessObservation | undefined>>;
  // 그 nonce의 프로세스를 정지 확인 뒤 새 nonce로 다시 띄운다. 이미 다른 nonce면 하지 않는다.
  restart(app: string, nonce: string): Promise<Result<void>>;
};

export type AppFacts = {
  id: string;
  status: "active" | "archived";
  run_enabled: boolean;
  active_release: string | null;
};

// 현재 ledger 사실. 호출자 자격이 아니라 core 안의 읽기 자격으로 읽는다.
export type ConnectFacts = {
  app(id: string): Promise<Result<AppFacts | null>>;
  // 그 앱의 active grant 전체(여러 page를 모은 것).
  grants(id: string): Promise<Result<readonly AppGrant[]>>;
};

export type ConnectorDeps = {
  clock: Clock;
  // core 시작마다 하나만 쥔다. confirm proof도 같은 signer가 서명한다(runtime/signing.ts).
  signer: CoreSigner;
  process: ProcessSource;
  facts: ConnectFacts;
  // platform 인증의 대상 판정. operation이 credential scope 안이고 대상이 맞을 때만 ok다.
  authorize(
    ctx: AuthenticatedContext,
    operation: string,
    target: { app: string },
  ): Result<void>;
  // credential_ref의 현재 상태. 폐기·만료·종료된 자격은 err다.
  current(credentialRef: string): Result<AuthenticatedContext>;
  ttlMs?: number;
};

export type ConnectResult = {
  endpoint: string;
  connection: AppConnection;
  // `{payload: connection, signature}`가 앱 direct 요청의 Authorization이다.
  signature: string;
};

type Issued = {
  credentialRef: string;
  app: string;
  processNonce: string;
  expiresAtMs: number;
  // agent connection이면 그 command가 아직 grant 안인지 sweep이 다시 본다.
  agent: boolean;
  commands: readonly string[];
};

export type AppConnector = {
  connect(
    ctx: AuthenticatedContext,
    input: AppConnectInput,
  ): Promise<Result<ConnectResult>>;
  // 발급한 connection 중 credential이 닫혔거나 agent 허락이 줄어든 것의 통로를 닫는다.
  // 닫기는 그 프로세스의 정지와 새 nonce 재시작이다. 닫은 프로세스 수를 돌려준다.
  sweep(): Promise<number>;
  // 지금 기억하는 발급 수(시험·관측).
  readonly issued: number;
};

function notFound(): Result<never> {
  return err({ code: "not_found", message: "app not found" });
}

function unavailable(message: string): Result<never> {
  return err({ code: "unavailable", message });
}

function kindOf(actor: string): string {
  return actor.split(":", 1)[0];
}

function sizesOf(
  requested: readonly string[] | undefined,
  declared: readonly ScreenSize[],
): ScreenSize[] {
  const wanted = requested === undefined
    ? declared
    : declared.filter((size) => requested.includes(size));
  return [...new Set(wanted)];
}

export function createAppConnector(deps: ConnectorDeps): AppConnector {
  const ttl = deps.ttlMs ?? CONNECTION_TTL_MS;
  const issued: Issued[] = [];

  function prune(nowMs: number): void {
    for (let index = issued.length - 1; index >= 0; index--) {
      if (issued[index].expiresAtMs <= nowMs) issued.splice(index, 1);
    }
  }

  // live는 현재 채택한 release의 ready·accepting 프로세스만 연결한다. 제어(machine)는
  // 준비 중인 프로세스에도 닿아야 하므로 관측만 있으면 된다.
  async function observe(
    ctx: AuthenticatedContext,
    input: AppConnectInput,
    facts: AppFacts,
  ): Promise<Result<ProcessObservation>> {
    const machine = kindOf(ctx.actor) === "machine";
    const found = await deps.process.current(
      input.mode === "preview"
        ? {
          app: input.app,
          mode: "preview",
          nonce: input.preview_nonce as string,
        }
        : { app: input.app, mode: "live" },
    );
    if (!found.ok) return found;
    const process = found.value;
    if (process === undefined || process.mode !== input.mode) {
      return unavailable("app is not running");
    }
    if (!machine && !process.ready) return unavailable("app is not ready");
    if (input.mode === "live") {
      if (process.release === null) {
        return unavailable("live process has no release");
      }
      if (!machine) {
        if (facts.status !== "active") return unavailable("app is archived");
        if (!facts.run_enabled) {
          return unavailable("app execution is stopped");
        }
        if (facts.active_release !== process.release) {
          return unavailable("running release is not the adopted release");
        }
        if (!process.accepting) return unavailable("app is not accepting");
      }
    }
    return ok(process);
  }

  // 역할·assignment 범위. 이 앱이 범위에 없으면 없는 앱과 같다.
  function agentEntry(
    ctx: AuthenticatedContext,
    app: string,
  ): { app: string; commands: readonly string[] } | undefined {
    const bound = (ctx.scope as { agent?: unknown }).agent as
      | { apps: readonly { app: string; commands: readonly string[] }[] }
      | undefined;
    return bound?.apps.find((item) => item.app === app);
  }

  // agent가 쓸 수 있는 command: 현재 프로세스가 등록한 것 ∩ 역할·assignment 범위.
  // 어느 하나라도 없으면 connection에 들어가지 않는다.
  function agentCommands(
    entry: { commands: readonly string[] },
    input: AppConnectInput,
    process: ProcessObservation,
  ): Result<string[]> {
    // agent grant는 Gate가 보고 앱 grant가 아니다. 여기서는 역할·assignment 범위와 등록한 command만 맞춘다.
    const allowedByGrant = process.commands;
    const allowed = new Set(
      entry.commands.filter((key) =>
        allowedByGrant.includes(key) && process.commands.includes(key)
      ),
    );
    const commands = input.commands.filter((key) => allowed.has(key));
    if (commands.length === 0) {
      return err({
        code: "forbidden",
        message: "no requested command is allowed for this agent",
      });
    }
    return ok(commands);
  }

  function agentCaller(
    ctx: AuthenticatedContext,
    input: AppConnectInput,
  ): Result<CallOrigin> {
    const claimed = input.caller;
    if (claimed === undefined || claimed.kind !== "agent") {
      return err({
        code: "invalid_input",
        message: "agent connection needs its tool call",
      });
    }
    // turn은 인증된 credential이 정한다. 본문이 다른 turn을 주장하면 거절한다.
    if (
      ctx.conditions.turn === undefined || claimed.run !== ctx.conditions.turn
    ) {
      return err({
        code: "forbidden",
        message: "caller run does not match the credential",
      });
    }
    return ok({
      kind: "agent",
      run: ctx.conditions.turn,
      tool_call: claimed.tool_call,
    });
  }

  async function connect(
    claimed: AuthenticatedContext,
    input: AppConnectInput,
  ): Promise<Result<ConnectResult>> {
    // 방금 인증한 context의 자격이 지금도 살아 있는지 다시 본다(그 사이 폐기·종료). scope와
    // 조건은 인증이 정한 그 context 그대로다. 본문이 아니라 인증이 준 값만 쓴다.
    if (!deps.current(claimed.credential_ref).ok) {
      return err({ code: "unauthorized", message: "credential unavailable" });
    }
    const ctx = claimed;
    const kind = kindOf(ctx.actor);
    const nowMs = deps.clock.nowMs();
    if (ctx.expires_at !== undefined && Date.parse(ctx.expires_at) <= nowMs) {
      return err({ code: "unauthorized", message: "credential expired" });
    }
    // 범위 밖 앱은 없는 앱과 같은 응답이다.
    const allowed = deps.authorize(ctx, appConnect.name, { app: input.app });
    if (!allowed.ok) {
      return allowed.error.code === "forbidden" ||
          allowed.error.code === "not_found"
        ? notFound()
        : allowed;
    }
    if (kind === "app") {
      // 앱끼리 연결은 source 자식의 broker 준비 요청이다(apps/connections).
      return err({
        code: "forbidden",
        message: "app connections are prepared through the broker",
      });
    }
    if (kind === "agent" && input.mode !== "live") {
      return err({
        code: "forbidden",
        message: "agent connections are live only",
      });
    }
    const app = await deps.facts.app(input.app);
    if (!app.ok) return app;
    if (app.value === null) return notFound();
    // 역할 범위 밖의 앱은 프로세스 상태를 보기 전에 없는 앱과 같게 답한다.
    const scoped = kind === "agent" ? agentEntry(ctx, input.app) : undefined;
    if (kind === "agent" && scoped === undefined) return notFound();
    const process = await observe(ctx, input, app.value);
    if (!process.ok) return process;
    const found = process.value;

    let commands: string[];
    let caller: CallOrigin | null = null;
    if (kind === "machine") {
      // 제어 connection이다. 화면·command 범위가 없다.
      commands = [];
    } else if (kind === "agent") {
      const origin = agentCaller(ctx, input);
      if (!origin.ok) return origin;
      caller = origin.value;
      const listed = agentCommands(scoped!, input, found);
      if (!listed.ok) return listed;
      commands = listed.value;
    } else {
      // user·coding_agent: 요청한 것 중 현재 프로세스가 등록한 command만이다.
      // 본문 caller 주장은 무시한다.
      commands = input.commands.filter((key) => found.commands.includes(key));
    }

    // 화면은 사람(shell main)의 연결만 받는다. 선언한 screen·size와의 교집합이다.
    const screens: string[] = [];
    const screenSizes: Record<string, ScreenSize[]> = {};
    if (kind === "user") {
      for (const screen of input.screens) {
        const declared = found.screens[screen];
        if (declared === undefined) continue;
        const sizes = sizesOf(input.screen_sizes[screen], declared);
        if (sizes.length === 0) continue;
        screens.push(screen);
        screenSizes[screen] = sizes;
      }
    }
    if (kind !== "machine" && screens.length === 0 && commands.length === 0) {
      return err({
        code: "invalid_input",
        message: "no requested screen or command is available",
      });
    }

    // command 범위는 정렬한다. 같은 범위는 같은 서명 bytes다.
    commands = [...new Set(commands)].sort();
    const credentialEnd = ctx.expires_at === undefined
      ? Number.POSITIVE_INFINITY
      : Date.parse(ctx.expires_at);
    const expiresAtMs = Math.min(nowMs + ttl, credentialEnd);
    const connection: AppConnection = {
      app: input.app,
      release: found.release,
      bundle_hash: found.bundleHash,
      mode: found.mode as ChannelMode,
      process_nonce: found.processNonce,
      actor: ctx.actor as AppConnection["actor"],
      credential_ref: ctx.credential_ref,
      screens,
      screen_sizes: screenSizes,
      caller,
      commands,
      expires_at: new Date(expiresAtMs).toISOString(),
    };
    const checked = appConnectionSchema.safeParse(connection);
    if (!checked.success) {
      return err({
        code: "invalid_input",
        message: "connection does not match its mode, screens, or caller",
      });
    }
    const signed = await deps.signer.signConnection(checked.data);
    // 제어(machine) connection은 supervisor의 짧은 요청이고 그 자격은 supervisor 수명이다.
    // 회수로 닫을 통로는 사람·agent·coding agent connection이다.
    if (kind !== "machine") {
      prune(nowMs);
      if (issued.length >= ISSUED_CONNECTION_LIMIT) {
        return unavailable("too many open connections");
      }
      issued.push({
        credentialRef: ctx.credential_ref,
        app: input.app,
        processNonce: found.processNonce,
        expiresAtMs,
        agent: kind === "agent",
        commands,
      });
    }
    return ok({
      endpoint: found.endpoint,
      connection: checked.data,
      signature: signed.signature,
    });
  }

  async function sweep(): Promise<number> {
    prune(deps.clock.nowMs());
    // 같은 프로세스는 한 번만 닫는다. 아직 열린 연결이 없는 것은 건드리지 않는다.
    const closing = new Map<string, { app: string; nonce: string }>();
    for (const record of [...issued]) {
      const key = `${record.app}/${record.processNonce}`;
      if (closing.has(key)) continue;
      if (!deps.current(record.credentialRef).ok) {
        closing.set(key, { app: record.app, nonce: record.processNonce });
        continue;
      }
    }
    let closed = 0;
    for (const { app, nonce } of closing.values()) {
      const restarted = await deps.process.restart(app, nonce);
      // 재시작을 요청하지 못했으면 기록을 남겨 다음 sweep이 다시 시도한다.
      if (!restarted.ok) continue;
      closed += 1;
      for (let index = issued.length - 1; index >= 0; index--) {
        const record = issued[index];
        if (record.app === app && record.processNonce === nonce) {
          issued.splice(index, 1);
        }
      }
    }
    return closed;
  }

  return {
    connect,
    sweep,
    get issued() {
      return issued.length;
    },
  };
}
