import { sha256Hex } from "../mod.ts";

// 고정 gitleaks credential prefix·PEM 규칙 묶음(platform/redaction#R2).
// 입력과 출력이 같은 content hash를 쓴다. 규칙 갱신은 이 묶음 전체를 바꾼다.
// 이 목록은 provider 지원 목록이 아니다.

export type CredentialPattern = {
  name: string;
  pattern: RegExp;
};

const PEM_BODY =
  "-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----[\\s\\S]*?-----END (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----";

export const CREDENTIAL_PATTERNS: readonly CredentialPattern[] = [
  { name: "openai", pattern: /sk-[A-Za-z0-9]{20,}/ },
  { name: "anthropic", pattern: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "github", pattern: /gh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: "aws", pattern: /AKIA[0-9A-Z]{16}/ },
  { name: "slack", pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  {
    name: "jwt",
    pattern: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  },
  { name: "pem", pattern: new RegExp(PEM_BODY) },
];

// hash 입력은 규칙 본문 그대로다. 이름·순서가 바뀌면 revision도 바뀐다.
const PATTERN_SOURCE = CREDENTIAL_PATTERNS.map((entry) =>
  `${entry.name}:${entry.pattern.source}`
).join("\n");

let revision: string | undefined;

export function patternRevision(): Promise<string> {
  if (revision) return Promise.resolve(revision);
  return sha256Hex(PATTERN_SOURCE).then((hash) => {
    revision = hash;
    return hash;
  });
}

// 조각 경계 보류에 쓴다. 고정 prefix(ghp_, sk-ant-, eyJ, AKIA, xoxb-)가
// 이 길이 안에 들어오므로 미완성 값은 내보내지 않는다.
export const MIN_CREDENTIAL_LENGTH = 24;

export function matchCredential(
  text: string,
): { index: number; length: number; name: string } | undefined {
  let best: { index: number; length: number; name: string } | undefined;
  for (const entry of CREDENTIAL_PATTERNS) {
    entry.pattern.lastIndex = 0;
    const found = entry.pattern.exec(text);
    if (!found) continue;
    const candidate = {
      index: found.index,
      length: found[0].length,
      name: entry.name,
    };
    if (
      !best || candidate.index < best.index ||
      (candidate.index === best.index && candidate.length > best.length)
    ) best = candidate;
  }
  return best;
}
