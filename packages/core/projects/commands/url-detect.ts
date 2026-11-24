import { PROJECT_COMMAND_DETECTED_URLS_MAX } from "../../../protocol/projects/project-commands.ts";

// ANSI 이스케이프(CSI, OSC, 2바이트 ESC)를 제거한다.
const ANSI_ESCAPE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping
  /[\u001b\u009b](?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, "");
}

// localhost / 127.0.0.1 / [::1] / 0.0.0.0 + 포트를 가진 http(s) URL을 추출한다(spec 3.4).
const LOCAL_URL_PATTERN =
  /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(\d{1,5})(?:\/[^\s"'<>)\],;]*)?/gi;

export function normalizeDetectedUrl(raw: string): string | null {
  try {
    const cleaned = raw.replace(/[.,;:!?)]+$/, "");
    const parsed = new URL(cleaned);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    const port = Number(parsed.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    if (parsed.hostname === "0.0.0.0") {
      parsed.hostname = "localhost";
    }
    // 끝의 빈 `/`만 정규화해 `http://localhost:3000/`과 `http://localhost:3000` 중복을 막는다.
    const formatted = parsed.toString();
    return parsed.pathname === "/" && parsed.search === "" && parsed.hash === ""
      ? formatted.slice(0, -1)
      : formatted;
  } catch {
    return null;
  }
}

export function extractLocalUrls(
  chunk: string,
  existing: readonly string[],
): string[] {
  if (existing.length >= PROJECT_COMMAND_DETECTED_URLS_MAX) return [];
  const plain = stripAnsi(chunk);
  const seen = new Set(existing);
  const added: string[] = [];
  for (const match of plain.matchAll(LOCAL_URL_PATTERN)) {
    const normalized = normalizeDetectedUrl(match[0]);
    if (normalized === null || seen.has(normalized)) continue;
    seen.add(normalized);
    added.push(normalized);
    if (seen.size >= PROJECT_COMMAND_DETECTED_URLS_MAX) break;
  }
  return added;
}
