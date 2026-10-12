/**
 * broker 서비스 시험용 fixture다. mod.ts에서 내보내지 않는다.
 *
 * 실행 범위는 실제 `effectiveScope`가 현재 선언과 active grant로 계산한다. 시험이 grant를
 * 만들고 회수하면 다음 요청부터 그 계산이 달라진다(apps/permissions#R14).
 */
import { ok, type Result } from "../../../base/mod.ts";
import type {
  Grant,
  GrantPermissionScope,
} from "../../../protocol/apps/mod.ts";
import type { AppDeclarations } from "../declarations.ts";
import { effectiveScope } from "../effective.ts";
import type { AccessState, BrokerAccess } from "../broker/access.ts";
import type { BrokerChild } from "../broker/invocations.ts";

export const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
export const OTHER_APP = "app_01h455vb4pex5v6nkc6gd5fdw2";
export const RELEASE = "rel_01h455vb4pex5v6nkc6gd5fdw1";
export const NONCE = "nonce-1";
export const CREDENTIAL = "broker-credential-1";
export const HASH = "ab".repeat(32);

export function child(over: Partial<BrokerChild> = {}): BrokerChild {
  return {
    app: APP,
    release: RELEASE,
    mode: "live",
    processNonce: NONCE,
    ...over,
  };
}

// 자식 연결이 정하는 신원 필드. 본문이 정하지 않는다.
export function withChild(
  body: Record<string, unknown>,
  who: Pick<BrokerChild, "processNonce" | "mode"> = child(),
): Record<string, unknown> {
  return { process_nonce: who.processNonce, mode: who.mode, ...body };
}

let counter = 0;

export type AccessFixture = BrokerAccess & {
  declarations: AppDeclarations | null;
  problemCodes: string[];
  grants: Grant[];
  grant(scope: GrantPermissionScope, app?: string): Grant;
  revoke(grant: Grant): void;
  lookups: number;
};

export function createAccessFixture(
  declarations: Partial<AppDeclarations> & {
    problemCodes?: string[];
  } = {},
): AccessFixture {
  const { problemCodes, ...declared } = declarations;
  const fixture: AccessFixture = {
    declarations: {
      release: RELEASE,
      permissions: [],
      app_connections: [],
      commands: ["sync"],
      automations: [],
      ...declared,
    },
    problemCodes: problemCodes ?? [],
    grants: [],
    lookups: 0,
    grant(scope, app = APP) {
      counter += 1;
      const suffix = counter.toString().padStart(2, "0");
      const made: Grant = {
        id: `grt_01h455vb4pex5v6nkc6gd5fd${suffix}`,
        app,
        kind: scope.kind,
        scope,
        approval: `apr_01h455vb4pex5v6nkc6gd5fd${suffix}`,
        status: "active",
        created_by: "user",
        created_at: "2026-10-06T00:00:00.000Z",
        revoked_by: null,
        revoked_at: null,
      };
      fixture.grants.push(made);
      return made;
    },
    revoke(grant) {
      const index = fixture.grants.findIndex((entry) => entry.id === grant.id);
      fixture.grants[index] = {
        ...grant,
        status: "revoked",
        revoked_by: "user",
        revoked_at: "2026-10-06T01:00:00.000Z",
      };
    },
    current(app): Promise<Result<AccessState | null>> {
      fixture.lookups += 1;
      const declarationsNow = fixture.declarations;
      if (declarationsNow === null || app !== APP) {
        return Promise.resolve(ok(null));
      }
      return Promise.resolve(ok({
        release: declarationsNow.release,
        scope: effectiveScope({
          app,
          declarations: declarationsNow,
          grants: fixture.grants,
          targetCommands: () => undefined,
        }),
        commands: declarationsNow.commands,
        problemCodes: fixture.problemCodes,
        automations: declarationsNow.automations,
      }));
    },
  };
  return fixture;
}

export function requirement(
  kind: "net.fetch" | "secret.use" | "document.save",
  scope: Record<string, unknown>,
): AppDeclarations["permissions"][number] {
  return {
    kind,
    scope,
    reason: "test",
  } as AppDeclarations["permissions"][number];
}

export type LocalServer = {
  readonly port: number;
  seen: { method: string; url: string; headers: Headers }[];
  stop(): Promise<void>;
};

// 시험용 local fake server다. 실제 외부 네트워크에는 나가지 않는다.
export function serveLocal(
  handler: (request: Request, port: number) => Response | Promise<Response>,
): LocalServer {
  const seen: LocalServer["seen"] = [];
  const server: Deno.HttpServer<Deno.NetAddr> = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    (request) => {
      seen.push({
        method: request.method,
        url: request.url,
        headers: new Headers(request.headers),
      });
      return handler(request, server.addr.port);
    },
  );
  return {
    get port() {
      return server.addr.port;
    },
    seen,
    stop: () => server.shutdown(),
  };
}
