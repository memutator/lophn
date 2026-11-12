import { sha256Hex } from "../mod.ts";

// 고정 gitleaks credential prefix·PEM 규칙 묶음.
// 입력과 출력이 같은 content hash를 쓴다. 규칙 갱신은 이 묶음 전체를 바꾼다.
// 이 목록은 provider 지원 목록이 아니다.

type CredentialPattern = {
  name: string;
  pattern: RegExp;
};

const PEM_FLAVORS = ["", "RSA ", "EC ", "OPENSSH ", "DSA ", "ENCRYPTED "];

const PEM_BODY =
  "-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----[\\s\\S]*?-----END (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----";

const PEM_HEADERS = PEM_FLAVORS.map(
  (flavor) => `-----BEGIN ${flavor}PRIVATE KEY-----`,
);
const PEM_FOOTER =
  /-----END (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/;

const CREDENTIAL_PATTERNS: readonly CredentialPattern[] = [
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

// stream에서 아직 다 오지 않은 match를 붙잡는 규칙이다. CREDENTIAL_PATTERNS의 항목마다 고정 prefix와
// 그 뒤에 이어질 수 있는 글을 둔다. 넓게 잡아도 된다: 넓으면 다음 batch까지 더 붙잡을 뿐이고, 좁으면
// secret의 앞부분이 live 글에 나간다. 지우는 결과가 같은 규칙이라 revision hash(PATTERN_SOURCE)에는
// 넣지 않는다.
type CredentialStreamRule =
  | {
      // match가 시작하는 고정 prefix 묶음.
      prefixes: readonly string[];
      // prefix 뒤 글자 하나가 match를 이어 갈 수 있는가와, 끝까지 이어질 수 있는 최대 글자 수.
      continues: (char: string) => boolean;
      maxAfter: number;
    }
  | {
      // match가 시작하는 고정 prefix 묶음.
      prefixes: readonly string[];
      // 글자 하나로 판정할 수 없는 "그 뒤 글". 지금은 PEM의 완성된 footer 부재다.
      tail: (text: string, from: number) => boolean;
    };

const isAlnum = (char: string) => /[A-Za-z0-9]/.test(char);
const isAnthropicTail = (char: string) => /[A-Za-z0-9_-]/.test(char);
const isAwsTail = (char: string) => /[0-9A-Z]/.test(char);
const isSlackTail = (char: string) => /[A-Za-z0-9-]/.test(char);
const isJwtTail = (char: string) => /[A-Za-z0-9_.-]/.test(char);

const CREDENTIAL_STREAM_RULES: readonly CredentialStreamRule[] = [
  { prefixes: ["sk-"], continues: isAlnum, maxAfter: Infinity },
  { prefixes: ["sk-ant-"], continues: isAnthropicTail, maxAfter: Infinity },
  {
    prefixes: ["ghp_", "gho_", "ghu_", "ghs_", "ghr_"],
    continues: isAlnum,
    maxAfter: Infinity,
  },
  { prefixes: ["AKIA"], continues: isAwsTail, maxAfter: 16 },
  {
    prefixes: ["xoxb-", "xoxa-", "xoxp-", "xoxr-", "xoxs-"],
    continues: isSlackTail,
    maxAfter: Infinity,
  },
  { prefixes: ["eyJ"], continues: isJwtTail, maxAfter: Infinity },
  {
    prefixes: PEM_HEADERS,
    tail: (text, from) => !PEM_FOOTER.test(text.slice(from)),
  },
];

// hash 입력은 규칙 본문 그대로다. 이름·순서가 바뀌면 revision도 바뀐다.
const PATTERN_SOURCE = CREDENTIAL_PATTERNS.map(
  (entry) => `${entry.name}:${entry.pattern.source}`,
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
      !best ||
      candidate.index < best.index ||
      (candidate.index === best.index && candidate.length > best.length)
    )
      best = candidate;
  }
  return best;
}

// text의 끝에서 시작하는 suffix가 어느 규칙의 match로 이어질 수 있는 앞부분이거나, 끝에 닿아 더
// 길어질 수 있는 match인 가장 이른 자리다. 그 자리부터는 다음 batch까지 내지 않는다.
export function credentialPrefixFrom(text: string): number | undefined {
  let earliest: number | undefined;
  const consider = (index: number) => {
    if (earliest === undefined || index < earliest) earliest = index;
  };
  for (const rule of CREDENTIAL_STREAM_RULES) {
    for (const prefix of rule.prefixes) {
      const start = tailPrefixStart(text, prefix);
      if (start !== undefined) consider(start);
    }
    if ("tail" in rule) {
      for (const prefix of rule.prefixes) {
        let from = 0;
        for (;;) {
          const index = text.indexOf(prefix, from);
          if (index < 0) break;
          if (rule.tail(text, index + prefix.length)) {
            consider(index);
            break;
          }
          from = index + 1;
        }
      }
      continue;
    }
    // 끝에서 거꾸로 이어지는 "그 뒤 글"의 묶음. 그 안에서 시작하는 prefix만 붙잡는다.
    const runStart = tailRunStart(text, rule.continues);
    for (const prefix of rule.prefixes) {
      const index = text.indexOf(
        prefix,
        Math.max(
          0,
          runStart - prefix.length,
          text.length - rule.maxAfter - prefix.length,
        ),
      );
      if (index >= 0) consider(index);
    }
  }
  return earliest;
}

// text 끝이 prefix의 앞부분인 가장 이른 자리. suffix가 prefix보다 길면 앞부분일 수 없다.
function tailPrefixStart(text: string, prefix: string): number | undefined {
  const longest = Math.min(text.length, prefix.length);
  for (let length = longest; length >= 1; length--) {
    const start = text.length - length;
    let same = true;
    for (let k = 0; k < length; k++) {
      if (text[start + k] !== prefix[k]) {
        same = false;
        break;
      }
    }
    if (same) return start;
  }
  return undefined;
}

// text 끝에서부터 continues가 참인 글자가 이어지는 묶음의 시작.
function tailRunStart(
  text: string,
  continues: (char: string) => boolean,
): number {
  let start = text.length;
  while (start > 0 && continues(text.charAt(start - 1))) start--;
  return start;
}
