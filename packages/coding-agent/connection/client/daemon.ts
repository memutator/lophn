// MCP·CLI가 같은 daemon 주소 순서를 쓰는 공통 찾기(connection#R15).
// 명시 옵션 → 환경 설정 → 현재 daemon 연결 정보 → 설치 설정 → 기본 loopback port.
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  DEFAULT_API_PORT,
  runMetadataSchema,
} from "../../../contracts/platform/mod.ts";

export const LOPHN_DAEMON_URL = "LOPHN_DAEMON_URL";

export type DaemonAddressSource =
  | "option"
  | "env"
  | "run_metadata"
  | "install_settings"
  | "default";

export type DaemonAddress = {
  url: string;
  source: DaemonAddressSource;
};

// loopback host만 받는다(platform/api allowedHosts와 같은 세 host다).
export function loopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]" ||
    host === "::1";
}

type ParsedAddress = { scheme: string; host: string; port: string };

// 입력 문자열은 log·진단에 그대로 쓰지 않는다. 사실만 판정한다.
function parseRef(value: string): ParsedAddress | undefined {
  try {
    const ref = new URL(value);
    return {
      scheme: ref.protocol.replace(/:$/, ""),
      host: ref.host,
      port: ref.port,
    };
  } catch {
    return undefined;
  }
}

// 명시 주소 하나를 검사한다. loopback 아닌 주소와 http 밖 scheme은 거절이다.
// 주소가 바뀌어도 token을 재발급하지 않는다(architecture 2.1).
export function acceptAddress(
  value: string,
  source: DaemonAddressSource,
): Result<DaemonAddress> {
  const ref = parseRef(value);
  if (!ref || ref.scheme !== "http" || ref.host === "") {
    return err({
      code: "invalid_input",
      message: "daemon 주소는 명시 http만 받는다",
    });
  }
  const host = ref.host.replace(/:\d+$/, "");
  if (!loopbackHost(host)) {
    return err({
      code: "invalid_input",
      message: "daemon 주소는 loopback만 받는다",
    });
  }
  const port = ref.port === "" ? String(DEFAULT_API_PORT) : ref.port;
  return ok({ url: `http://${host}:${port}`, source });
}

// 현재 daemon 연결 정보는 H/run/location.json의 위치 metadata다. credential은 없다.
export function runMetadataAddress(
  value: unknown,
): Result<DaemonAddress> {
  const parsed = runMetadataSchema.safeParse(value);
  if (!parsed.success) {
    return err({ code: "not_found", message: "위치 metadata가 올바르지 않다" });
  }
  return ok({
    url: `http://127.0.0.1:${parsed.data.api_port}`,
    source: "run_metadata",
  });
}

// 설치 설정의 위치 값도 loopback만 받는다. 값은 platform/install contract가 정한다.
export type InstallSettings = { host?: unknown; port?: unknown };

export function installSettingsAddress(
  settings: InstallSettings | undefined,
): Result<DaemonAddress> {
  const port = settings?.port;
  if (
    typeof port !== "number" || !Number.isInteger(port) || port < 1 ||
    port > 65535
  ) {
    return err({ code: "not_found", message: "설치 설정에 port가 없다" });
  }
  const host = typeof settings?.host === "string" && settings.host !== ""
    ? settings.host
    : "127.0.0.1";
  if (!loopbackHost(host)) {
    return err({
      code: "invalid_input",
      message: "설치 설정의 host는 loopback만 받는다",
    });
  }
  return ok({ url: `http://${host}:${port}`, source: "install_settings" });
}

export function defaultAddress(): DaemonAddress {
  return {
    url: `http://127.0.0.1:${DEFAULT_API_PORT}`,
    source: "default",
  };
}

export type DaemonAddressInputs = {
  option?: string;
  env?: string;
  runMetadata?: unknown;
  installSettings?: InstallSettings | undefined;
};

function explicitResult(
  value: string,
  source: DaemonAddressSource,
): Result<DaemonAddress> {
  const trimmed = value.trim();
  if (trimmed === "") {
    return err({
      code: "invalid_input",
      message: "명시 daemon 주소가 비어 있다",
    });
  }
  return acceptAddress(trimmed, source);
}

// 순서는 명시 옵션 → 환경 설정 → 현재 daemon 연결 정보 → 설치 설정 → 기본이다.
// 명시 주소의 거절은 다음 단계로 내려가지 않는다. 출처 값은 주입한다.
export function resolveDaemonAddress(
  sources: DaemonAddressInputs,
): Result<DaemonAddress> {
  if (sources.option !== undefined) {
    return explicitResult(sources.option, "option");
  }
  if (sources.env !== undefined) return explicitResult(sources.env, "env");
  if (sources.runMetadata !== undefined) {
    return runMetadataAddress(sources.runMetadata);
  }
  if (sources.installSettings !== undefined) {
    return installSettingsAddress(sources.installSettings);
  }
  return ok(defaultAddress());
}

// 현재 daemon 연결 정보(`<H>/run/location.json`)까지 읽어 주소를 정한다. 파일을 읽는 일은
// 주입한 `readText`가 한다(없거나 못 읽으면 undefined). MCP·CLI 실행 entry가 같은 순서를 쓴다.
export function discoverDaemonAddress(sources: {
  option?: string;
  env?: string;
  dataRoot?: string;
  readText(path: string): string | undefined;
}): Result<DaemonAddress> {
  let runMetadata: unknown;
  if (
    sources.option === undefined && sources.env === undefined &&
    sources.dataRoot !== undefined && sources.dataRoot !== ""
  ) {
    const text = sources.readText(
      `${sources.dataRoot.replace(/\/$/, "")}/run/location.json`,
    );
    if (text !== undefined) {
      try {
        runMetadata = JSON.parse(text);
      } catch {
        // 읽을 수 없는 metadata는 없는 것과 같다. 다음 출처로 내려간다.
      }
    }
  }
  const resolved = resolveDaemonAddress({
    option: sources.option,
    env: sources.env,
    runMetadata,
  });
  // metadata가 올바르지 않아 not_found면 기본 주소로 내려간다. 명시 주소의 거절은 그대로다.
  if (!resolved.ok && resolved.error.code === "not_found") {
    return ok(defaultAddress());
  }
  return resolved;
}
