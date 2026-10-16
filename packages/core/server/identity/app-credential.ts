// 앱 supervisor의 신뢰 runtime 경계에서 발급하는 app credential.
// 요청은 감독 pipe의 app_credential_request다.
// token은 이 응답으로만 나가고 앱 사용자 코드에는 없다. 종료·판 교체·회수에 폐기한다.

import { err, type Logger, type Result } from "../../../base/mod.ts";
import {
  appCredentialRequestSchema,
  appCredentialResponseSchema,
} from "../../../protocol/supervision/mod.ts";
import type { CredentialIssue } from "./registry.ts";
import type { CredentialRegistry } from "./registry.ts";

type AppCredentialResponse = {
  type: "app_credential_response";
  request_id: string;
  credential: string;
  credential_ref: string;
  expires_at?: string;
};

// 앱 supervisor만 부른다. 앱 사용자 코드에 노출하는 발급 경로가 아니다.
export type AppCredentialIssuer = {
  // 감독 pipe의 발급 요청을 받아 응답 schema 모양으로 돌려준다.
  // token은 이 응답에만 있고 결과·오류·log에 남기지 않는다.
  request(message: unknown): Promise<Result<AppCredentialResponse>>;
  // 판 교체·앱 종료 때 그 supervisor process의 자격을 폐기한다.
  endProcess(process: string): number;
  // 판 교체 때 그 release의 모든 app credential을 폐기한다.
  endRelease(release: string): number;
  // 앱 종료 때 그 앱의 모든 app credential을 폐기한다.
  endApp(app: string): number;
  // 회수는 registry 기록으로만 한다. token 원문을 받지 않는다.
  revoke(credentialRef: string): Result<void>;
  end(credentialRef: string): Result<void>;
};

const INVALID = {
  code: "invalid_input" as const,
  message: "app credential 요청 모양이 아니거나 발급 상한을 넘는다",
};

const UNAVAILABLE = {
  code: "unavailable" as const,
  message: "app credential 발급을 사용할 수 없다",
};

export function createAppCredentialIssuer(options: {
  registry: CredentialRegistry;
  // 발급 상한. 요청마다 같은 목록이고 registry operation policy 안에 있어야 한다.
  operations: readonly string[];
  // 응답 기한. 없으면 만료를 기한 없이 registry가 검사한다.
  expires_at?: string;
  logger?: Logger;
}): AppCredentialIssuer {
  async function request(
    message: unknown,
  ): Promise<Result<AppCredentialResponse>> {
    const parsed = appCredentialRequestSchema.safeParse(message);
    if (!parsed.success) return err(INVALID);
    const request = parsed.data;
    const issue: CredentialIssue = {
      actor: `app:${request.app}` as const,
      principal: `app:${request.app}`,
      scope: {
        operations: [...options.operations],
        targets: {
          app: request.app,
          ...(request.release === null ? {} : { release: request.release }),
          process: request.process,
          mode: request.mode,
          // 발급 때 고정한 보고 위치 근거. collector가 보고할 때 대상으로 쓴다.
          ...(request.bundle_hash === undefined
            ? {}
            : { bundle_hash: request.bundle_hash }),
          ...(request.diagnostic_scope === undefined
            ? {}
            : { diagnostic_scope: request.diagnostic_scope }),
        },
      },
      conditions: {
        app: request.app,
        ...(request.release === null ? {} : { release: request.release }),
        process: request.process,
        mode: request.mode,
        ...(request.bundle_hash === undefined
          ? {}
          : { bundle_hash: request.bundle_hash }),
        ...(request.diagnostic_scope === undefined
          ? {}
          : { diagnostic_scope: request.diagnostic_scope }),
      },
      ...(options.expires_at === undefined
        ? {}
        : { expires_at: options.expires_at }),
    };
    const issued = await options.registry.issue(issue);
    if (!issued.ok) return issued;
    // 응답 schema를 설된다. token은 이 응답에만 있다.
    const response = appCredentialResponseSchema.safeParse({
      type: "app_credential_response",
      request_id: String(request.request_id),
      credential: issued.value.token,
      credential_ref: issued.value.credential_ref,
      ...(options.expires_at === undefined
        ? {}
        : { expires_at: options.expires_at }),
    });
    if (!response.success) return err(UNAVAILABLE);
    return { ok: true, value: response.data };
  }

  return {
    request,
    endProcess: (process) => options.registry.endBy("process", process),
    endRelease: (release) => options.registry.endBy("release", release),
    endApp: (app) => options.registry.endBy("app", app),
    revoke: (credentialRef) => options.registry.revoke(credentialRef),
    end: (credentialRef) => options.registry.end(credentialRef),
  };
}
