// 외부 전송 대역(apps/preview#R4). 네트워크에 나가지 않는다. 선언한 host·port만 받고 요청은 메모리에만
// 남기며 응답은 주입한 값(기본: 상태 200, 빈 본문)이다. loopback은 선언했어도 받지 않는다:
// preview에는 실제 loopback 듣기·플랫폼 port 접근이 없다.
import { ok, type Result } from "../../../base/mod.ts";
import { brokerNetFetchInputSchema } from "../../../contracts/apps/mod.ts";
import {
  isLoopbackHost,
  type NetFetchOutput,
  type NetFetchService,
} from "../../permissions/mod.ts";
import type { PreviewScope } from "../model.ts";
import { invalid, refuse, standInOnly } from "./refusal.ts";

export type PreviewExternalRequest = {
  host: string;
  port: number;
  method: string;
  path: string;
  command: string;
};

export type PreviewExternalService = NetFetchService & {
  readonly requests: readonly PreviewExternalRequest[];
};

export function createPreviewExternalService(
  scope: Pick<PreviewScope, "net">,
  respond?: (request: PreviewExternalRequest) => Result<NetFetchOutput>,
): PreviewExternalService {
  const requests: PreviewExternalRequest[] = [];
  return {
    requests,
    request(child, body) {
      const parsed = brokerNetFetchInputSchema.safeParse(body);
      if (!parsed.success) {
        return Promise.resolve(invalid("net fetch input is invalid"));
      }
      const input = parsed.data;
      const host = input.host.toLowerCase();
      const target = { host, port: input.port };
      const refused = standInOnly(child, "net.fetch", target);
      if (refused) return Promise.resolve(refused);
      if (
        isLoopbackHost(host) ||
        !scope.net.some((entry) =>
          entry.host === host && entry.port === input.port
        )
      ) {
        return Promise.resolve(refuse("net.fetch", target));
      }
      const request: PreviewExternalRequest = {
        ...target,
        method: input.method.toUpperCase(),
        path: input.path,
        command: input.command,
      };
      requests.push(request);
      return Promise.resolve(
        respond ? respond(request) : ok({ status: 200, body: null }),
      );
    },
  };
}
