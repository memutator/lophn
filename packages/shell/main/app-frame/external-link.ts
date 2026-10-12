// 앱의 외부 링크. live·preview 모두 HTTP·HTTPS이면서 userinfo가 없고
// 8,192자 이하인 URL만 확인 없이 OS 기본 browser로 연다. 앱 view 안에서는 열지 않는다(view
// 탐색은 자기 scheme만 통과한다, network-policy.ts). 기록에는 origin·path만 남기고 query·
// fragment(OAuth state·비밀)는 어디에도 쓰지 않는다. shell 크롬의 링크 경로와 caller를 섞지 않는다.
// 이 모듈은 앱 view의 `app:open-external`만 받는다.
import { EXTERNAL_URL_MAX_CHARS } from "../../../protocol/shell/app-bridge-types.ts";
import type { CallOutcome } from "./app-call.ts";
import type { BoundView } from "./registry.ts";

/** contracts externalUrlSchema와 같은 검사. 통과하면 URL 그대로, 아니면 undefined다. */
export function checkExternalUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > EXTERNAL_URL_MAX_CHARS) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (url.username !== "" || url.password !== "") return undefined;
  return value;
}

/** 기록에 남기는 것만. */
export function externalLinkRecord(
  url: string,
): { origin: string; path: string } {
  const parsed = new URL(url);
  return { origin: parsed.origin, path: parsed.pathname };
}

export interface ExternalLinkDeps {
  /** OS 기본 browser로 연다. 실패하면 reject한다. */
  open(url: string): Promise<void>;
  log(line: string): void;
}

export function createExternalLinks(deps: ExternalLinkDeps) {
  return {
    /** `app:open-external` 하나. 입력은 `{url}`만이다. */
    async open(view: BoundView, value: unknown): Promise<CallOutcome<null>> {
      const input = typeof value === "object" && value !== null &&
          !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
      const url = input !== undefined && Object.keys(input).join(",") === "url"
        ? checkExternalUrl(input.url)
        : undefined;
      if (url === undefined) {
        return {
          ok: false,
          error: { code: "invalid_input", message: "external link is invalid" },
        };
      }
      const { origin, path } = externalLinkRecord(url);
      const where = `app=${view.target.app} mode=${view.target.mode} ` +
        `origin=${origin} path=${path}`;
      try {
        await deps.open(url);
      } catch {
        deps.log(`external link not opened ${where}`);
        return {
          ok: false,
          error: { code: "unavailable", message: "browser did not open" },
        };
      }
      deps.log(`external link opened ${where}`);
      return { ok: true, value: null };
    },
  };
}
