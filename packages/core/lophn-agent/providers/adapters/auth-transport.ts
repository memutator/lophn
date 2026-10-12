// 인증 transport(provider#R3, R25; platform#T20 secret 전송 부착). adapter의 이
// 파일만 secret 전송 부착을 machine credential으로 부른다(architecture §5.2).
// API key 값은 transport callback 메모리에서만 산다. 결과·오류·log·run loop·
// ModelCall blob에는 값이나 header가 남지 않는다(R7, R15).

import { err, ok, type Result } from "../../../../base/mod.ts";
import type {
  SecretSendInput,
  SecretUse,
} from "../../../../protocol/secrets/mod.ts";

export type SecretAttachLike = {
  send(
    input: SecretSendInput,
    // 값은 callback 인자로만 넘긴다. 결과에는 전송 여부뿐이다.
    transmit: (
      value: Uint8Array | string,
    ) => Promise<Result<{ sent: boolean }>>,
  ): Promise<Result<{ sent: boolean }>>;
};

// invoice가 아니다. protocol이 명시하는 인증 header 종류다(R5).
export type AuthKind = "api_key" | "bearer";

export type TransportRequest = {
  // endpoint는 API base다(§5.2). adapter가 표의 path를 붙인다.
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  // 사람 취소와 시도 기한이다. 전송과 body 읽기를 함께 끊는다.
  signal?: AbortSignal;
};

// 응답 body는 둘 중 하나다. 성공 SSE는 stream으로 흘려 parser가 읽고, 그 밖의
// 응답(오류·JSON batch)은 크기 상한 안에서 한 덩어리 json 문자열로 읽는다.
// 두 길은 동시에 쓰지 않는다.
export type TransportResponse = {
  status: number;
  headers: Headers;
  // SSE body 전체. 크기 상한과 frame 파싱은 parser가 맡는다.
  stream: ReadableStream<Uint8Array> | null;
  // stream이 아닌 응답의 상한 안 본문. 분류에 쓰고 보존하지 않는다.
  json: string | null;
};

export type Transport = (
  request: TransportRequest,
) => Promise<Result<TransportResponse>>;

export type AuthTransport = {
  // 인증 header를 붙여 실제 전송을 부른다. credential 부착 지점은 이 send 하나다.
  send(request: TransportRequest): Promise<Result<TransportResponse>>;
};

export function createAuthTransport(options: {
  attach: SecretAttachLike;
  transport: Transport;
  // context는 caller 주장을 믿지 않는다. supervisor가 주입하고 attach가 재검사한다.
  context: SecretSendInput["context"];
  // secret 참조·판·용도·목적지. platform#T20 contract의 짝이다.
  use: SecretUse;
  // 전송 기준 operation. 허용 목적지와 판이 다르면 fail closed다.
  operation: string;
  headerName: string;
  kind: AuthKind;
}): AuthTransport {
  return {
    async send(request) {
      let response: TransportResponse | undefined;
      const transmit = async (
        value: Uint8Array | string,
      ): Promise<Result<{ sent: boolean }>> => {
        // header 값은 이 callback 메모리에서만 산다(Pi식 attach 밖 반출 없음).
        const headers = { ...request.headers };
        headers[options.headerName] = kindValue(options.kind, value);
        const sent = await options.transport({ ...request, headers });
        if (!sent.ok) return sent;
        response = sent.value;
        return ok({ sent: true });
      };
      const input: SecretSendInput = {
        context: options.context,
        use: options.use,
        operation: options.operation,
        // body는 전송 근거다. header 값과 credential 값은 여기 없다(R7).
        body: { url: request.url, method: request.method },
      };
      const sent = await options.attach.send(input, transmit);
      // 전송 실패·허용 거절은 그대로. 오류에 header 값·credential 값은 없다(R19).
      if (!sent.ok) return sent;
      if (response === undefined) {
        // transmit이 부르지 않았다는 것은 attach가 잘못 응답한 것이다.
        return err({ code: "internal", message: "전송 응답이 없다" });
      }
      return ok(response);
    },
  };
}

function kindValue(kind: AuthKind, value: Uint8Array | string): string {
  const text = typeof value === "string"
    ? value
    : new TextDecoder().decode(value);
  if (kind === "bearer") return `Bearer ${text}`;
  return text;
}
