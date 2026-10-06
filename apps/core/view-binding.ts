// view exception 귀속(problems/reporting#R6). shell main이 보내는 view 오류의 `binding`은 core가
// 서명한 AppConnection(`apps.connect`가 낸 SignedConnection JSON)이다. 서명 key는 core 시작마다 하나인
// appsControl.signer의 것이라, 검증은 core가 collector worker로 넘기기 전에 한다. 검증된 payload의
// app·release·mode·bundle_hash만 worker에 넘기고 페이지·본문 주장은 버린다. 위조·만료·형식 오류는
// 없는 route와 같은 not_found로 거절한다.
import { err, type LophnError, type Result } from "../../packages/base/mod.ts";
import { signedConnectionSchema } from "../../packages/contracts/apps/mod.ts";
import { observeViewError } from "../../packages/contracts/problems/mod.ts";
import type {
  WorkerRequest,
  WorkerResponse,
} from "../../packages/contracts/platform/mod.ts";
import type { CoreSigner } from "../../packages/apps/runtime/signing.ts";
import type { WorkerRouteTarget } from "../../packages/platform/responsiveness/mod.ts";

export const VIEW_ERROR_KEY =
  `${observeViewError.resource}/${observeViewError.method}`;

export type ViewBindingDeps = {
  // appsControl.signer: core 시작마다 하나인 서명 key 쥠이다.
  signer: Pick<CoreSigner, "verifyConnection">;
  nowMs(): number;
};

const NOT_FOUND: LophnError = { code: "not_found", message: "route not found" };

export function withViewBinding(
  workers: ReadonlyMap<string, WorkerRouteTarget>,
  deps: ViewBindingDeps,
): ReadonlyMap<string, WorkerRouteTarget> {
  const target = workers.get(VIEW_ERROR_KEY);
  if (target === undefined) return workers;
  const wrapped: WorkerRouteTarget = {
    ...target,
    handle: {
      observation: () => target.handle.observation(),
      async forward(
        request: WorkerRequest,
      ): Promise<Result<WorkerResponse, LophnError>> {
        const bound = await verified(request.payload, deps);
        if (bound === undefined) return err(NOT_FOUND);
        return await target.handle.forward({ ...request, payload: bound });
      },
    },
  };
  return new Map([...workers, [VIEW_ERROR_KEY, wrapped]]);
}

// 서명과 만료가 맞으면 worker로 넘길 payload를 만든다. view의 app·release·mode·bundle_hash는
// 검증한 연결의 값으로 덮는다.
async function verified(
  payload: unknown,
  deps: ViewBindingDeps,
): Promise<unknown | undefined> {
  const body = payload as {
    view: Record<string, unknown> & { binding: string };
    observation: unknown;
  };
  let signed;
  try {
    signed = signedConnectionSchema.safeParse(JSON.parse(body.view.binding));
  } catch {
    return undefined;
  }
  if (!signed.success) return undefined;
  const connection = signed.data.payload;
  if (!await deps.signer.verifyConnection(signed.data)) {
    return undefined;
  }
  if (
    connection.expires_at !== null &&
    Date.parse(connection.expires_at) <= deps.nowMs()
  ) return undefined;
  return {
    view: {
      ...body.view,
      app: connection.app,
      release: connection.release,
      mode: connection.mode,
      bundle_hash: connection.bundle_hash,
    },
    observation: body.observation,
  };
}
