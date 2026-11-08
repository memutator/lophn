// CLI가 core API 주소를 찾는 순서다. 명시 주소(option·`LOPHN_DAEMON_URL`) → identify가 알린 주소.
// metadata file·설치 설정·고정 port로 내려가는 길은 없다.
import { err, ok, type Result } from "../../../base/mod.ts";
import { DEFAULT_API_PORT } from "../../../protocol/base/mod.ts";

export const LOPHN_DAEMON_URL = "LOPHN_DAEMON_URL";

type DaemonAddressSource = "option" | "env";

export type DaemonAddress = {
  url: string;
  source: DaemonAddressSource;
};

// 입력 문자열은 log·진단에 그대로 쓰지 않는다. 사실만 판정한다.
function portOf(value: string): string | undefined {
  try {
    const ref = new URL(value);
    return ref.port === "" ? String(DEFAULT_API_PORT) : ref.port;
  } catch {
    return undefined;
  }
}

// 명시 주소 하나를 검사한다. loopback 아닌 주소와 http 밖 scheme은 거절이다.
function acceptAddress(
  value: string,
  source: DaemonAddressSource,
): Result<DaemonAddress> {
  let ref: URL;
  try {
    ref = new URL(value);
  } catch {
    return err({
      code: "invalid_input",
      message: "daemon 주소는 명시 http만 받는다",
    });
  }
  const scheme = ref.protocol.replace(/:$/, "");
  if (scheme !== "http" || ref.host === "") {
    return err({
      code: "invalid_input",
      message: "daemon 주소는 명시 http만 받는다",
    });
  }
  const host = ref.host.replace(/:\d+$/, "");
  if (
    host !== "127.0.0.1" &&
    host !== "localhost" &&
    host !== "[::1]" &&
    host !== "::1"
  ) {
    return err({
      code: "invalid_input",
      message: "daemon 주소는 loopback만 받는다",
    });
  }
  const port = ref.port === "" ? String(DEFAULT_API_PORT) : ref.port;
  return ok({ url: `http://${host}:${port}`, source });
}

// 주소를 준 곳이 있으면 그 주소가 정본이다. 없으면 undefined이고 부르는 쪽이 identify를 쓴다.
// 명시 주소의 거절은 identify로 내려가지 않는다.
export function explicitDaemonAddress(input: {
  option?: string;
  env?: string;
}): Result<DaemonAddress | undefined> {
  const given =
    input.option !== undefined
      ? { value: input.option, source: "option" as const }
      : input.env !== undefined
        ? { value: input.env, source: "env" as const }
        : undefined;
  if (given === undefined) return ok(undefined);
  const trimmed = given.value.trim();
  if (trimmed === "") {
    return err({
      code: "invalid_input",
      message: "명시 daemon 주소가 비어 있다",
    });
  }
  return acceptAddress(trimmed, given.source);
}

// 자격을 얻은 core와 명시 주소가 같은 core인지 본다. 둘 다 loopback http라 port 하나가 서버를 가른다.
// 같은 port면 `127.0.0.1`·`localhost`·`[::1]` 가운데 어느 이름으로 불러도 같은 core다.
export function sameCoreAddress(a: string, b: string): boolean {
  const port = portOf(a);
  return port !== undefined && port === portOf(b);
}
