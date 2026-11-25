import { posix } from "node:path";
import type {
  PermissionRule,
  PermissionRuleLayers,
} from "../../../protocol/approvals/mod.ts";

// 64 KiB를 넘는 shell 명령은 검사기가 읽지 않고 opaque로 다룬다(allow·읽기 목록 통과 불가).
export const MAX_SHELL_COMMAND_BYTES = 65_536;
const MAX_UNWRAP_DEPTH = 8;

type ScannedWord = {
  readonly text: string;
  readonly quoted: boolean;
  readonly hasVarExpansion: boolean;
  readonly hasCommandSubstitution: boolean;
};

export type ShellSegmentOrigin = "top" | "subshell" | "wrapper";

export type ShellSegment = {
  readonly raw: string;
  readonly words: readonly string[];
  readonly command: string;
  readonly elevated: boolean;
  readonly hasOutputRedirection: boolean;
  readonly redirectionTargets: readonly string[];
  readonly hasCommandSubstitution: boolean;
  readonly hasDangerousEnv: boolean;
  readonly viaEvalOrXargs: boolean;
  readonly origin: ShellSegmentOrigin;
  readonly unwrapped: boolean;
};

export type ShellScanResult = {
  readonly normalized: string;
  readonly opaque: boolean;
  readonly elevated: boolean;
  readonly multiline: boolean;
  readonly hasOutputRedirection: boolean;
  readonly hasDangerousEnv: boolean;
  readonly redirectionTargets: readonly string[];
  readonly segments: readonly ShellSegment[];
  readonly floorCandidates: readonly string[];
};

export type ShellRuleEvaluation = {
  readonly action: PermissionRule["action"] | null;
  readonly pattern: string | null;
  readonly source: PermissionRule["source"] | null;
};

// 공백을 줄여 맞춘다. `rm  -rf /`처럼 공백 하나 더한 것으로 규칙을 비켜 가지 않게 한다.
export function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function baseNameOf(command: string): string {
  const slash = command.lastIndexOf("/");
  return slash >= 0 ? command.slice(slash + 1) : command;
}

const DANGEROUS_ENV_VARS = new Set([
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "PATH",
  "BASH_ENV",
  "ENV",
  "IFS",
  "PROMPT_COMMAND",
  "CDPATH",
  "NODE_OPTIONS",
  "PYTHONPATH",
  "RUBYOPT",
  "PERL5OPT",
]);

const ENV_ASSIGNMENT_RE = /^([A-Za-z_][A-Za-z0-9_]*)=/;

type PendingHeredoc = {
  readonly delimiter: string;
  readonly stripTabs: boolean;
  readonly quoted: boolean;
  readonly segmentIndex: number;
};

type RawSegment = {
  words: ScannedWord[];
  hasOutputRedirection: boolean;
  redirectionTargets: string[];
  hasCommandSubstitution: boolean;
  nestedScripts: string[];
  heredocBodies: string[];
};

function emptyRawSegment(): RawSegment {
  return {
    words: [],
    hasOutputRedirection: false,
    redirectionTargets: [],
    hasCommandSubstitution: false,
    nestedScripts: [],
    heredocBodies: [],
  };
}

// `$(...)`나 `(...)`의 짝 맞는 `)` 위치를 찾는다. 따옴표와 중첩을 지킨다. 닫히지 않으면 -1.
function findMatchingParen(source: string, openIndex: number): number {
  let depth = 1;
  let i = openIndex + 1;
  let inSingle = false;
  let inDouble = false;
  while (i < source.length) {
    const ch = source[i];
    if (inSingle) {
      if (ch === "'") inSingle = false;
      i++;
      continue;
    }
    if (inDouble) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === '"') {
        inDouble = false;
        i++;
        continue;
      }
      if (ch === "$" && source[i + 1] === "(") {
        const innerEnd = findMatchingParen(source, i + 1);
        if (innerEnd === -1) return -1;
        i = innerEnd + 1;
        continue;
      }
      if (ch === "`") {
        const innerEnd = findClosingBacktick(source, i);
        if (innerEnd === -1) return -1;
        i = innerEnd + 1;
        continue;
      }
      i++;
      continue;
    }
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      i++;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      i++;
      continue;
    }
    if (ch === "`") {
      const innerEnd = findClosingBacktick(source, i);
      if (innerEnd === -1) return -1;
      i = innerEnd + 1;
      continue;
    }
    if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

// `` `...` ``의 닫는 역따옴표 위치를 찾는다. 닫히지 않으면 -1.
function findClosingBacktick(source: string, openIndex: number): number {
  let i = openIndex + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "`") return i;
    i++;
  }
  return -1;
}

function unescapeBacktickBody(body: string): string {
  return body.replace(/\\([$`\\])/g, "$1");
}

function extractSubstitutionsFromText(
  text: string,
  out: string[],
): { opaque: boolean } {
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "$" && text[i + 1] === "(") {
      const end = findMatchingParen(text, i + 1);
      if (end === -1) return { opaque: true };
      out.push(text.slice(i + 2, end));
      i = end + 1;
      continue;
    }
    if (ch === "`") {
      const end = findClosingBacktick(text, i);
      if (end === -1) return { opaque: true };
      out.push(unescapeBacktickBody(text.slice(i + 1, end)));
      i = end + 1;
      continue;
    }
    i++;
  }
  return { opaque: false };
}

type TokenizeResult = {
  readonly segments: readonly RawSegment[];
  readonly opaque: boolean;
};

// 순수 TypeScript 상태 기계 스캐너. 따옴표·이스케이프·heredoc·주석·연산자·서브셸·명령 치환·리다이렉션을 푼다.
function tokenizeShell(source: string): TokenizeResult {
  const segments: RawSegment[] = [];
  let current = emptyRawSegment();
  let opaque = false;
  const pendingHeredocs: PendingHeredoc[] = [];

  const flushSegment = () => {
    if (
      current.words.length > 0 ||
      current.hasOutputRedirection ||
      current.nestedScripts.length > 0 ||
      current.heredocBodies.length > 0
    ) {
      segments.push(current);
      current = emptyRawSegment();
    }
  };

  let i = 0;
  const len = source.length;

  const consumeHeredocs = () => {
    while (pendingHeredocs.length > 0) {
      const hd = pendingHeredocs.shift()!;
      const lines: string[] = [];
      let closed = false;
      while (i < len) {
        let lineEnd = source.indexOf("\n", i);
        if (lineEnd === -1) lineEnd = len;
        let line = source.slice(i, lineEnd);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        i = lineEnd < len ? lineEnd + 1 : len;
        const candidate = hd.stripTabs ? line.replace(/^\t+/, "") : line;
        if (candidate === hd.delimiter) {
          closed = true;
          break;
        }
        lines.push(line);
      }
      if (!closed) {
        opaque = true;
        return;
      }
      const body = lines.join("\n");
      const targetSeg = segments[hd.segmentIndex] ?? current;
      targetSeg.heredocBodies.push(body);
      if (!hd.quoted) {
        const sub = extractSubstitutionsFromText(body, targetSeg.nestedScripts);
        if (sub.opaque) opaque = true;
        if (targetSeg.nestedScripts.length > 0) {
          targetSeg.hasCommandSubstitution = true;
        }
      }
    }
  };

  // 공백·탭만 건너뛴다(줄바꿈은 연산자라 따로 처리).
  const skipInlineSpace = () => {
    while (i < len && (source[i] === " " || source[i] === "\t")) i++;
  };

  // 한 단어를 읽는다(따옴표·이스케이프·치환 포함).
  const readWord = (): ScannedWord | null => {
    let text = "";
    let quoted = false;
    let hasVarExpansion = false;
    let hasCommandSubstitution = false;
    let started = false;

    while (i < len) {
      const ch = source[i];
      if (
        ch === " " ||
        ch === "\t" ||
        ch === "\n" ||
        ch === "\r" ||
        ch === ";" ||
        ch === "|" ||
        ch === "&" ||
        ch === "<" ||
        ch === ">" ||
        ch === "(" ||
        ch === ")"
      ) {
        break;
      }
      if (!started && ch === "#") {
        // 단어 시작의 `#`은 줄 끝까지 주석이다.
        while (i < len && source[i] !== "\n") i++;
        break;
      }
      started = true;
      if (ch === "'") {
        quoted = true;
        i++;
        const start = i;
        while (i < len && source[i] !== "'") i++;
        if (i >= len) {
          opaque = true;
          text += source.slice(start);
          break;
        }
        text += source.slice(start, i);
        i++;
        continue;
      }
      if (ch === '"') {
        quoted = true;
        i++;
        let closed = false;
        while (i < len) {
          const dc = source[i];
          if (dc === '"') {
            closed = true;
            i++;
            break;
          }
          if (dc === "\\") {
            if (i + 1 >= len) {
              opaque = true;
              i++;
              break;
            }
            const next = source[i + 1];
            if (next === "\n") {
              i += 2;
              continue;
            }
            if (next === '"' || next === "\\" || next === "$" || next === "`") {
              text += next;
              i += 2;
              continue;
            }
            text += `\\${next}`;
            i += 2;
            continue;
          }
          if (dc === "$" && source[i + 1] === "(") {
            hasCommandSubstitution = true;
            current.hasCommandSubstitution = true;
            const end = findMatchingParen(source, i + 1);
            if (end === -1) {
              opaque = true;
              i = len;
              break;
            }
            const inner = source.slice(i + 2, end);
            current.nestedScripts.push(inner);
            text += source.slice(i, end + 1);
            i = end + 1;
            continue;
          }
          if (dc === "`") {
            hasCommandSubstitution = true;
            current.hasCommandSubstitution = true;
            const end = findClosingBacktick(source, i);
            if (end === -1) {
              opaque = true;
              i = len;
              break;
            }
            const inner = unescapeBacktickBody(source.slice(i + 1, end));
            current.nestedScripts.push(inner);
            text += source.slice(i, end + 1);
            i = end + 1;
            continue;
          }
          if (
            dc === "$" &&
            i + 1 < len &&
            /[A-Za-z_{?*@#!-]/.test(source[i + 1])
          ) {
            hasVarExpansion = true;
          }
          text += dc;
          i++;
        }
        if (!closed) opaque = true;
        continue;
      }
      if (ch === "\\") {
        if (i + 1 >= len) {
          opaque = true;
          i++;
          break;
        }
        const next = source[i + 1];
        if (next === "\n") {
          i += 2;
          continue;
        }
        quoted = true;
        text += next;
        i += 2;
        continue;
      }
      if (ch === "$" && source[i + 1] === "(") {
        hasCommandSubstitution = true;
        current.hasCommandSubstitution = true;
        const end = findMatchingParen(source, i + 1);
        if (end === -1) {
          opaque = true;
          i = len;
          break;
        }
        const inner = source.slice(i + 2, end);
        current.nestedScripts.push(inner);
        text += source.slice(i, end + 1);
        i = end + 1;
        continue;
      }
      if (ch === "`") {
        hasCommandSubstitution = true;
        current.hasCommandSubstitution = true;
        const end = findClosingBacktick(source, i);
        if (end === -1) {
          opaque = true;
          i = len;
          break;
        }
        const inner = unescapeBacktickBody(source.slice(i + 1, end));
        current.nestedScripts.push(inner);
        text += source.slice(i, end + 1);
        i = end + 1;
        continue;
      }
      if (ch === "$" && i + 1 < len && /[A-Za-z_{?*@#!-]/.test(source[i + 1])) {
        hasVarExpansion = true;
      }
      text += ch;
      i++;
    }
    return started
      ? { text, quoted, hasVarExpansion, hasCommandSubstitution }
      : null;
  };

  while (i < len) {
    skipInlineSpace();
    if (i >= len) break;

    const ch = source[i];
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      i++;
      flushSegment();
      if (pendingHeredocs.length > 0) consumeHeredocs();
      continue;
    }
    if (ch === "#") {
      while (i < len && source[i] !== "\n") i++;
      continue;
    }
    // 제어 연산자: `&&`, `||`, `;`, `|&`, `|`, `&` (단 `&>`·`&>>`는 리다이렉션)
    if (ch === ";") {
      i++;
      flushSegment();
      continue;
    }
    if (ch === "|") {
      if (source[i + 1] === "|" || source[i + 1] === "&") i += 2;
      else i++;
      flushSegment();
      continue;
    }
    if (ch === "&") {
      if (source[i + 1] === ">") {
        // `&>` 또는 `&>>`
        const isAppend = source[i + 2] === ">";
        i += isAppend ? 3 : 2;
        skipInlineSpace();
        const target = readWord();
        current.hasOutputRedirection = true;
        if (target) current.redirectionTargets.push(target.text);
        continue;
      }
      if (source[i + 1] === "&") i += 2;
      else i++;
      flushSegment();
      continue;
    }
    // 서브셸 `(...)`
    if (ch === "(") {
      const end = findMatchingParen(source, i);
      if (end === -1) {
        opaque = true;
        break;
      }
      const inner = source.slice(i + 1, end);
      current.nestedScripts.push(inner);
      i = end + 1;
      continue;
    }
    if (ch === ")") {
      opaque = true;
      i++;
      flushSegment();
      continue;
    }
    // 프로세스 치환 `<(...)`·`>(...)`
    if ((ch === "<" || ch === ">") && source[i + 1] === "(") {
      if (ch === ">") current.hasOutputRedirection = true;
      current.hasCommandSubstitution = true;
      const end = findMatchingParen(source, i + 1);
      if (end === -1) {
        opaque = true;
        break;
      }
      current.nestedScripts.push(source.slice(i + 2, end));
      i = end + 1;
      continue;
    }
    // 숫자 fd 접두사가 붙은 리다이렉션(`2>&1`, `2>err`, `1>>out` 등)
    const fdMatch = /^(\d+)(>>|>\|>|>&|<&|<<<|<<-|<<|<>|>|<)/.exec(
      source.slice(i),
    );
    if (fdMatch !== null || ch === ">" || ch === "<") {
      let op: string;
      if (fdMatch !== null) {
        i += fdMatch[1].length;
        op = fdMatch[2];
        i += op.length;
      } else {
        const opMatch = /^(>>|>\|>|>&|<&|<<<|<<-|<<|<>|>|<)/.exec(
          source.slice(i),
        );
        op = opMatch ? opMatch[1] : ch;
        i += op.length;
      }
      skipInlineSpace();
      const target = readWord();
      if (op === "<<" || op === "<<-") {
        if (!target || target.text === "") {
          opaque = true;
        } else {
          pendingHeredocs.push({
            delimiter: target.text,
            stripTabs: op === "<<-",
            quoted: target.quoted,
            segmentIndex: segments.length,
          });
        }
      } else if (op === ">&" || op === "<&") {
        // `2>&1`, `1>&2`, `>&-` 같은 fd 복제는 파일 쓰기가 아니다. 그 밖의 `>&file`은 출력 리다이렉션이다.
        if (op === ">&" && target && !/^(\d+|-)$/.test(target.text)) {
          current.hasOutputRedirection = true;
          current.redirectionTargets.push(target.text);
        }
      } else if (op === ">" || op === ">>" || op === ">|" || op === "<>") {
        current.hasOutputRedirection = true;
        if (target) current.redirectionTargets.push(target.text);
      }
      continue;
    }

    const word = readWord();
    if (word !== null) {
      current.words.push(word);
    } else {
      i++;
    }
  }

  flushSegment();
  if (pendingHeredocs.length > 0) {
    opaque = true;
  }

  return { segments, opaque };
}

function normalizePathTarget(target: string, homeDir?: string): string {
  let value = target.trim();
  if (value === "") return value;

  // `$HOME`·`${HOME}`을 `~`로 정규화한다.
  if (value === "$HOME" || value === "${HOME}") return "~";
  if (value.startsWith("$HOME/")) {
    value = `~/${value.slice("$HOME/".length)}`;
  } else if (value.startsWith("${HOME}/")) {
    value = `~/${value.slice("${HOME}/".length)}`;
  }

  const normalizedHome = homeDir
    ? posix.normalize(homeDir).replace(/\/+$/, "")
    : undefined;

  if (value === "~") return "~";
  if (value.startsWith("~/")) {
    const rest = value.slice(2);
    if (rest === "" || rest === "." || /^\/+$/.test(rest)) return "~/";
    if (/^\/*\*$/.test(rest)) return "~/*";
    const resolved = posix.normalize(`/${rest}`);
    if (resolved === "/") return "~";
    if (resolved === "/*") return "~/*";
    return `~${resolved}`;
  }

  if (value.startsWith("/")) {
    const trailingSlash = value.endsWith("/") && value.length > 1;
    const norm = posix.normalize(value);
    if (norm === "/") return "/";
    if (norm === "/*") return "/*";
    if (normalizedHome && normalizedHome !== "/") {
      const stripped = norm.replace(/\/+$/, "");
      if (stripped === normalizedHome) {
        return trailingSlash ? "~/" : "~";
      }
      if (stripped === `${normalizedHome}/*`) {
        return "~/*";
      }
    }
    return norm;
  }

  return value;
}

// `rm`의 flag 순서·조합(`-rf`, `-fr`, `-r -f`, `--recursive --force`, `-Rf` 등)과 경로(`$HOME`, 실제 home, `//`)를
// floor 규칙 비교 전에 정규화한다.
function rmFloorCandidates(
  words: readonly string[],
  elevated: boolean,
  homeDir?: string,
): string[] {
  if (words.length === 0) return [];
  const cmd = baseNameOf(words[0]);
  if (cmd !== "rm") return [];

  let recursive = false;
  let force = false;
  let endOfOpts = false;
  const targets: string[] = [];

  for (let idx = 1; idx < words.length; idx++) {
    const arg = words[idx];
    if (!endOfOpts && arg === "--") {
      endOfOpts = true;
      continue;
    }
    if (!endOfOpts && arg.startsWith("--")) {
      if (arg === "--recursive") recursive = true;
      else if (arg === "--force") force = true;
      continue;
    }
    if (!endOfOpts && arg.startsWith("-") && arg.length > 1) {
      const chars = arg.slice(1);
      if (chars.includes("r") || chars.includes("R")) recursive = true;
      if (chars.includes("f")) force = true;
      continue;
    }
    targets.push(arg);
  }

  if (!recursive || !force) return [];

  const out: string[] = [];
  for (const rawTarget of targets) {
    const norm = normalizePathTarget(rawTarget, homeDir);
    out.push(`rm -rf ${norm}`);
    if (elevated) out.push(`sudo rm -rf ${norm}`);
  }
  return out;
}

// `/sbin/mkfs.ext4`, `/bin/dd` 같은 절대 경로 호출도 floor 규칙에 맞게 basename 후보를 낸다.
function canonicalFloorCandidates(
  words: readonly string[],
  elevated: boolean,
  homeDir?: string,
): string[] {
  if (words.length === 0) return [];
  const out: string[] = [];
  const joined = normalize(words.join(" "));
  if (joined) out.push(joined);
  const cmd = baseNameOf(words[0]);
  if (cmd !== words[0]) {
    const baseJoined = normalize([cmd, ...words.slice(1)].join(" "));
    if (baseJoined) out.push(baseJoined);
    if (elevated) out.push(`sudo ${baseJoined}`);
  } else if (elevated) {
    out.push(`sudo ${joined}`);
  }
  out.push(...rmFloorCandidates(words, elevated, homeDir));
  return out;
}

type UnwrapResult =
  | { readonly kind: "none" }
  | {
      readonly kind: "script";
      readonly script: string;
      readonly elevated: boolean;
      readonly opaque: boolean;
      readonly viaEvalOrXargs: boolean;
    }
  | {
      readonly kind: "tokens";
      readonly words: readonly ScannedWord[];
      readonly elevated: boolean;
      readonly opaque: boolean;
      readonly viaEvalOrXargs: boolean;
      readonly hasDangerousEnv: boolean;
    };

function unwrapCommand(words: readonly ScannedWord[]): UnwrapResult {
  if (words.length === 0) return { kind: "none" };
  const cmd = baseNameOf(words[0].text);
  const args = words.slice(1);

  // `sh -c` / `bash -c` / `zsh -c` / `dash -c` / `ksh -c` (`-lc`, `-ec`, `-c --` 등 포함)
  if (
    cmd === "sh" ||
    cmd === "bash" ||
    cmd === "zsh" ||
    cmd === "dash" ||
    cmd === "ksh"
  ) {
    for (let idx = 0; idx < args.length; idx++) {
      const arg = args[idx].text;
      if (arg === "--") break;
      if (arg === "-o" || arg === "+o") {
        idx++;
        continue;
      }
      if (arg.startsWith("-") && !arg.startsWith("--") && arg.includes("c")) {
        let scriptIdx = idx + 1;
        while (scriptIdx < args.length) {
          const next = args[scriptIdx].text;
          if (next === "--" || next === "-") {
            scriptIdx++;
            break;
          }
          if (next === "-o" || next === "+o") {
            scriptIdx += 2;
            continue;
          }
          if (next.startsWith("-") || next.startsWith("+")) {
            scriptIdx++;
            continue;
          }
          break;
        }
        const scriptWord = args[scriptIdx];
        if (!scriptWord) return { kind: "none" };
        // `sh -c "$CMD"`처럼 본문 전체가 변수 참조 하나면 opaque다.
        const dynamicOnly =
          scriptWord.hasVarExpansion &&
          /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(scriptWord.text.trim());
        return {
          kind: "script",
          script: scriptWord.text,
          elevated: false,
          opaque: dynamicOnly,
          viaEvalOrXargs: false,
        };
      }
    }
    return { kind: "none" };
  }

  if (cmd === "eval") {
    if (args.length === 0) return { kind: "none" };
    // `eval`에 `$HOME` 외의 변수 확장이 있으면 동적 eval이라 opaque 표시를 단다.
    const hasDynamicVar = args.some((w) => {
      if (!w.hasVarExpansion) return false;
      const stripped = w.text.replace(/\$\{?HOME\}?/g, "");
      return /\$[A-Za-z_{?*@#!-]/.test(stripped);
    });
    return {
      kind: "script",
      script: args.map((w) => w.text).join(" "),
      elevated: false,
      opaque: hasDynamicVar,
      viaEvalOrXargs: true,
    };
  }

  if (cmd === "exec") {
    let idx = 0;
    while (idx < args.length) {
      const a = args[idx].text;
      if (a === "--") {
        idx++;
        break;
      }
      if (a === "-a") {
        idx += 2;
        continue;
      }
      if (a === "-c" || a === "-l" || (a.startsWith("-a") && a.length > 2)) {
        idx++;
        continue;
      }
      break;
    }
    const rest = args.slice(idx);
    return rest.length > 0
      ? {
          kind: "tokens",
          words: rest,
          elevated: false,
          opaque: false,
          viaEvalOrXargs: false,
          hasDangerousEnv: false,
        }
      : { kind: "none" };
  }

  if (cmd === "env") {
    let idx = 0;
    let hasDangerousEnv = false;
    while (idx < args.length) {
      const a = args[idx].text;
      if (a === "--") {
        idx++;
        break;
      }
      if (a === "-") {
        idx++;
        continue;
      }
      if (a === "-S" || a === "--split-string") {
        const scriptWord = args[idx + 1];
        if (!scriptWord) return { kind: "none" };
        return {
          kind: "script",
          script: scriptWord.text,
          elevated: false,
          opaque: false,
          viaEvalOrXargs: false,
        };
      }
      if (a.startsWith("--split-string=")) {
        return {
          kind: "script",
          script: a.slice("--split-string=".length),
          elevated: false,
          opaque: false,
          viaEvalOrXargs: false,
        };
      }
      // `-S"rm -rf ~"` 또는 `-iS"rm -rf ~"` 같은 붙은 short flag 처리
      if (a.startsWith("-") && !a.startsWith("--") && a.length > 1) {
        const sPos = a.indexOf("S", 1);
        if (sPos >= 1 && /^[i0v]*$/.test(a.slice(1, sPos))) {
          const attached = a.slice(sPos + 1);
          if (attached.length > 0) {
            return {
              kind: "script",
              script: attached,
              elevated: false,
              opaque: false,
              viaEvalOrXargs: false,
            };
          }
          const scriptWord = args[idx + 1];
          if (!scriptWord) return { kind: "none" };
          return {
            kind: "script",
            script: scriptWord.text,
            elevated: false,
            opaque: false,
            viaEvalOrXargs: false,
          };
        }
        if ((a.startsWith("-u") || a.startsWith("-C")) && a.length > 2) {
          idx++;
          continue;
        }
      }
      if (a === "-u" || a === "-C") {
        idx += 2;
        continue;
      }
      if (
        a === "-i" ||
        a === "-0" ||
        a === "-v" ||
        a === "--ignore-environment" ||
        a === "--null" ||
        a === "--debug" ||
        a.startsWith("--unset=") ||
        a.startsWith("--chdir=")
      ) {
        idx++;
        continue;
      }
      const envMatch = ENV_ASSIGNMENT_RE.exec(a);
      if (envMatch) {
        if (DANGEROUS_ENV_VARS.has(envMatch[1])) hasDangerousEnv = true;
        idx++;
        continue;
      }
      break;
    }
    const rest = args.slice(idx);
    return rest.length > 0
      ? {
          kind: "tokens",
          words: rest,
          elevated: false,
          opaque: false,
          viaEvalOrXargs: false,
          hasDangerousEnv,
        }
      : { kind: "none" };
  }

  if (cmd === "command") {
    let idx = 0;
    while (idx < args.length) {
      const a = args[idx].text;
      if (a === "-v" || a === "-V") return { kind: "none" };
      if (a === "--") {
        idx++;
        break;
      }
      if (a === "-p") {
        idx++;
        continue;
      }
      break;
    }
    const rest = args.slice(idx);
    return rest.length > 0
      ? {
          kind: "tokens",
          words: rest,
          elevated: false,
          opaque: false,
          viaEvalOrXargs: false,
          hasDangerousEnv: false,
        }
      : { kind: "none" };
  }

  if (cmd === "builtin" || cmd === "nohup" || cmd === "time") {
    let idx = 0;
    while (idx < args.length) {
      const a = args[idx].text;
      if (a === "--") {
        idx++;
        break;
      }
      if (cmd === "time" && a === "-p") {
        idx++;
        continue;
      }
      break;
    }
    const rest = args.slice(idx);
    return rest.length > 0
      ? {
          kind: "tokens",
          words: rest,
          elevated: false,
          opaque: false,
          viaEvalOrXargs: false,
          hasDangerousEnv: false,
        }
      : { kind: "none" };
  }

  // `coproc cmd...` 또는 `coproc NAME { cmd...; }` — 백그라운드 코프로세스이므로 최상위 segment는 유지하고 안쪽 명령만 풀어 검사한다.
  if (cmd === "coproc") {
    let rest = args;
    if (
      rest.length >= 2 &&
      !rest[1].quoted &&
      rest[1].text === "{" &&
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(rest[0].text)
    ) {
      rest = rest.slice(1);
    }
    return rest.length > 0
      ? {
          kind: "tokens",
          words: rest,
          elevated: false,
          opaque: false,
          viaEvalOrXargs: false,
          hasDangerousEnv: false,
        }
      : { kind: "none" };
  }

  if (cmd === "timeout") {
    let idx = 0;
    while (idx < args.length) {
      const a = args[idx].text;
      if (a === "--") {
        idx++;
        break;
      }
      if (
        a === "-s" ||
        a === "-k" ||
        a === "--signal" ||
        a === "--kill-after"
      ) {
        idx += 2;
        continue;
      }
      if (
        a === "-v" ||
        a === "--verbose" ||
        a === "--foreground" ||
        a === "--preserve-status" ||
        a.startsWith("--signal=") ||
        a.startsWith("--kill-after=") ||
        ((a.startsWith("-s") || a.startsWith("-k")) && a.length > 2)
      ) {
        idx++;
        continue;
      }
      break;
    }
    // duration 인자 하나를 건너뛴다.
    idx++;
    const rest = args.slice(idx);
    return rest.length > 0
      ? {
          kind: "tokens",
          words: rest,
          elevated: false,
          opaque: false,
          viaEvalOrXargs: false,
          hasDangerousEnv: false,
        }
      : { kind: "none" };
  }

  if (cmd === "nice") {
    let idx = 0;
    while (idx < args.length) {
      const a = args[idx].text;
      if (a === "--") {
        idx++;
        break;
      }
      if (a === "-n" || a === "--adjustment") {
        idx += 2;
        continue;
      }
      if (
        a.startsWith("--adjustment=") ||
        (a.startsWith("-n") && a.length > 2) ||
        /^-\d+$/.test(a)
      ) {
        idx++;
        continue;
      }
      break;
    }
    const rest = args.slice(idx);
    return rest.length > 0
      ? {
          kind: "tokens",
          words: rest,
          elevated: false,
          opaque: false,
          viaEvalOrXargs: false,
          hasDangerousEnv: false,
        }
      : { kind: "none" };
  }

  if (cmd === "xargs") {
    let idx = 0;
    while (idx < args.length) {
      const a = args[idx].text;
      if (a === "--") {
        idx++;
        break;
      }
      if (
        a === "-n" ||
        a === "-L" ||
        a === "-P" ||
        a === "-I" ||
        a === "-J" ||
        a === "-d" ||
        a === "-s" ||
        a === "-E" ||
        a === "-a"
      ) {
        idx += 2;
        continue;
      }
      if (a.startsWith("-")) {
        idx++;
        continue;
      }
      break;
    }
    const rest = args.slice(idx);
    return rest.length > 0
      ? {
          kind: "tokens",
          words: rest,
          elevated: false,
          opaque: false,
          viaEvalOrXargs: true,
          hasDangerousEnv: false,
        }
      : { kind: "none" };
  }

  if (cmd === "sudo") {
    let idx = 0;
    let hasDangerousEnv = false;
    while (idx < args.length) {
      const a = args[idx].text;
      if (a === "--") {
        idx++;
        break;
      }
      if (
        a === "-u" ||
        a === "-g" ||
        a === "-C" ||
        a === "-D" ||
        a === "-h" ||
        a === "-p" ||
        a === "-r" ||
        a === "-t" ||
        a === "-T" ||
        a === "-U"
      ) {
        idx += 2;
        continue;
      }
      if (a.startsWith("-")) {
        idx++;
        continue;
      }
      const envMatch = ENV_ASSIGNMENT_RE.exec(a);
      if (envMatch) {
        if (DANGEROUS_ENV_VARS.has(envMatch[1])) hasDangerousEnv = true;
        idx++;
        continue;
      }
      break;
    }
    const rest = args.slice(idx);
    return rest.length > 0
      ? {
          kind: "tokens",
          words: rest,
          elevated: true,
          opaque: false,
          viaEvalOrXargs: false,
          hasDangerousEnv,
        }
      : { kind: "none" };
  }

  if (cmd === "doas") {
    let idx = 0;
    while (idx < args.length) {
      const a = args[idx].text;
      if (a === "--") {
        idx++;
        break;
      }
      if (a === "-u" || a === "-C") {
        idx += 2;
        continue;
      }
      if (a.startsWith("-")) {
        idx++;
        continue;
      }
      break;
    }
    const rest = args.slice(idx);
    return rest.length > 0
      ? {
          kind: "tokens",
          words: rest,
          elevated: true,
          opaque: false,
          viaEvalOrXargs: false,
          hasDangerousEnv: false,
        }
      : { kind: "none" };
  }

  if (cmd === "su") {
    for (let idx = 0; idx < args.length; idx++) {
      const a = args[idx].text;
      if (a === "-c") {
        const scriptWord = args[idx + 1];
        if (!scriptWord) return { kind: "none" };
        return {
          kind: "script",
          script: scriptWord.text,
          elevated: true,
          opaque: false,
          viaEvalOrXargs: false,
        };
      }
      if (a.startsWith("-c") && a.length > 2) {
        return {
          kind: "script",
          script: a.slice(2),
          elevated: true,
          opaque: false,
          viaEvalOrXargs: false,
        };
      }
      if (a.startsWith("--command=")) {
        return {
          kind: "script",
          script: a.slice("--command=".length),
          elevated: true,
          opaque: false,
          viaEvalOrXargs: false,
        };
      }
    }
    return { kind: "none" };
  }

  return { kind: "none" };
}

const LEADING_SHELL_KEYWORDS = new Set([
  "{",
  "!",
  "if",
  "then",
  "elif",
  "else",
  "do",
  "while",
  "until",
]);

function stripLeadingKeywordsAndEnv(words: readonly ScannedWord[]): {
  readonly rest: readonly ScannedWord[];
  readonly hasDangerousEnv: boolean;
} {
  let start = 0;
  let end = words.length;
  let hasDangerousEnv = false;
  let strippedBrace = false;

  while (start < end) {
    const w = words[start];
    if (w.quoted) break;
    if (LEADING_SHELL_KEYWORDS.has(w.text)) {
      if (w.text === "{") strippedBrace = true;
      start++;
      continue;
    }
    const match = ENV_ASSIGNMENT_RE.exec(w.text);
    if (match) {
      if (DANGEROUS_ENV_VARS.has(match[1])) hasDangerousEnv = true;
      start++;
      continue;
    }
    break;
  }

  if (strippedBrace && end > start) {
    const last = words[end - 1];
    if (!last.quoted && last.text === "}") {
      end--;
    }
  }

  return { rest: words.slice(start, end), hasDangerousEnv };
}

const ELEVATED_COMMANDS = new Set(["sudo", "doas", "su"]);

export function scanShellCommand(
  command: string,
  homeDir?: string,
): ShellScanResult {
  const normalized = normalize(command);
  const multiline = /[\r\n]/.test(command);

  if (
    command.length > MAX_SHELL_COMMAND_BYTES ||
    Buffer.byteLength(command, "utf8") > MAX_SHELL_COMMAND_BYTES
  ) {
    return {
      normalized: normalized.slice(0, 256),
      opaque: true,
      elevated: false,
      multiline,
      hasOutputRedirection: false,
      hasDangerousEnv: false,
      redirectionTargets: [],
      segments: [],
      floorCandidates: [],
    };
  }

  let opaque = false;
  let elevated = false;
  let hasOutputRedirection = false;
  let anyDangerousEnv = false;
  const redirectionTargets: string[] = [];
  const segments: ShellSegment[] = [];
  const floorCandidates = new Set<string>();
  if (normalized !== "") floorCandidates.add(normalized);

  function processWords(
    words: readonly ScannedWord[],
    inherited: {
      elevated: boolean;
      hasOutputRedirection: boolean;
      redirectionTargets: readonly string[];
      hasCommandSubstitution: boolean;
      hasDangerousEnv: boolean;
      viaEvalOrXargs: boolean;
      origin: ShellSegmentOrigin;
    },
    depth: number,
  ): void {
    if (depth > MAX_UNWRAP_DEPTH) {
      opaque = true;
      return;
    }
    const stripped = stripLeadingKeywordsAndEnv(words);
    const hasDangerousEnv =
      inherited.hasDangerousEnv || stripped.hasDangerousEnv;
    if (hasDangerousEnv) anyDangerousEnv = true;
    const effective = stripped.rest;
    if (effective.length === 0) return;

    const head = effective[0];
    // 명령 이름 자체가 변수(`$CMD`)나 명령 치환(`$(echo rm)`)이면 opaque다.
    if (
      head.hasCommandSubstitution ||
      (head.hasVarExpansion && /^\$|\$\{/.test(head.text))
    ) {
      opaque = true;
    }

    const texts = effective.map((w) => w.text);
    const cmd = baseNameOf(texts[0]);
    const isElevated = inherited.elevated || ELEVATED_COMMANDS.has(cmd);
    if (isElevated) elevated = true;

    const raw = normalize(texts.join(" "));
    for (const candidate of canonicalFloorCandidates(
      texts,
      isElevated,
      homeDir,
    )) {
      floorCandidates.add(candidate);
    }

    const viaEvalOrXargs =
      inherited.viaEvalOrXargs || cmd === "eval" || cmd === "xargs";

    segments.push({
      raw,
      words: texts,
      command: cmd,
      elevated: isElevated,
      hasOutputRedirection: inherited.hasOutputRedirection,
      redirectionTargets: inherited.redirectionTargets,
      hasCommandSubstitution: inherited.hasCommandSubstitution,
      hasDangerousEnv,
      viaEvalOrXargs,
      origin: inherited.origin,
      unwrapped: inherited.origin !== "top",
    });

    const unwrapped = unwrapCommand(effective);
    if (unwrapped.kind === "none") return;
    if (unwrapped.opaque) opaque = true;
    if (unwrapped.elevated) elevated = true;

    if (unwrapped.kind === "script") {
      scanScript(
        unwrapped.script,
        {
          elevated: isElevated || unwrapped.elevated,
          hasDangerousEnv,
          viaEvalOrXargs: viaEvalOrXargs || unwrapped.viaEvalOrXargs,
          origin: "wrapper",
        },
        depth + 1,
      );
    } else {
      const nextDangerousEnv = hasDangerousEnv || unwrapped.hasDangerousEnv;
      if (nextDangerousEnv) anyDangerousEnv = true;
      processWords(
        unwrapped.words,
        {
          elevated: isElevated || unwrapped.elevated,
          hasOutputRedirection: inherited.hasOutputRedirection,
          redirectionTargets: inherited.redirectionTargets,
          hasCommandSubstitution: inherited.hasCommandSubstitution,
          hasDangerousEnv: nextDangerousEnv,
          viaEvalOrXargs: viaEvalOrXargs || unwrapped.viaEvalOrXargs,
          origin: "wrapper",
        },
        depth + 1,
      );
    }
  }

  function scanScript(
    script: string,
    inherited: {
      elevated: boolean;
      hasDangerousEnv: boolean;
      viaEvalOrXargs: boolean;
      origin: ShellSegmentOrigin;
    },
    depth: number,
  ): void {
    if (depth > MAX_UNWRAP_DEPTH) {
      opaque = true;
      return;
    }
    const normScript = normalize(script);
    if (normScript !== "") floorCandidates.add(normScript);
    const tokenized = tokenizeShell(script);
    if (tokenized.opaque) opaque = true;

    for (const seg of tokenized.segments) {
      if (seg.hasOutputRedirection) hasOutputRedirection = true;
      redirectionTargets.push(...seg.redirectionTargets);

      processWords(
        seg.words,
        {
          elevated: inherited.elevated,
          hasOutputRedirection: seg.hasOutputRedirection,
          redirectionTargets: seg.redirectionTargets,
          hasCommandSubstitution: seg.hasCommandSubstitution,
          hasDangerousEnv: inherited.hasDangerousEnv,
          viaEvalOrXargs: inherited.viaEvalOrXargs,
          origin: inherited.origin,
        },
        depth,
      );

      // `sh <<EOF ... EOF`처럼 shell에 heredoc으로 넘긴 본문도 벗겨 검사한다.
      const stripped = stripLeadingKeywordsAndEnv(seg.words).rest;
      const headCmd = stripped.length > 0 ? baseNameOf(stripped[0].text) : "";
      if (
        seg.heredocBodies.length > 0 &&
        (headCmd === "sh" ||
          headCmd === "bash" ||
          headCmd === "zsh" ||
          headCmd === "dash" ||
          headCmd === "ksh")
      ) {
        for (const body of seg.heredocBodies) {
          scanScript(
            body,
            {
              elevated: inherited.elevated,
              hasDangerousEnv: inherited.hasDangerousEnv,
              viaEvalOrXargs: inherited.viaEvalOrXargs,
              origin: "wrapper",
            },
            depth + 1,
          );
        }
      }

      const nestedOrigin: ShellSegmentOrigin =
        inherited.origin === "wrapper" ? "wrapper" : "subshell";
      for (const nested of seg.nestedScripts) {
        scanScript(
          nested,
          {
            elevated: inherited.elevated,
            hasDangerousEnv: inherited.hasDangerousEnv,
            viaEvalOrXargs: inherited.viaEvalOrXargs,
            origin: nestedOrigin,
          },
          depth + 1,
        );
      }
    }
  }

  scanScript(
    command,
    {
      elevated: false,
      hasDangerousEnv: false,
      viaEvalOrXargs: false,
      origin: "top",
    },
    0,
  );

  return {
    normalized,
    opaque,
    elevated,
    multiline,
    hasOutputRedirection,
    hasDangerousEnv: anyDangerousEnv,
    redirectionTargets,
    segments,
    floorCandidates: [...floorCandidates],
  };
}

// ---------- 패턴 매칭 ----------

// `*` 밖의 글자는 모두 escape하고, `\*`는 글자 그대로의 `*`다.
function toSource(pattern: string): string {
  return pattern
    .split(/(\\\*|\*)/)
    .map((part) =>
      part === "*"
        ? ".*"
        : part === "\\*"
          ? "\\*"
          : part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("");
}

export function shellRuleMatches(pattern: string, text: string): boolean {
  const normalized = normalize(pattern);
  if (normalized === "") return false;
  // 끝의 ` *`는 없어도 맞는다. always가 더한 `npm test *`가 `npm test` 자신에 맞아야 다시 묻지 않는다.
  const source = normalized.endsWith(" *")
    ? `${toSource(normalized.slice(0, -2))}( .*)?`
    : toSource(normalized);
  return new RegExp(`^${source}$`).test(normalize(text));
}

// ---------- 내장 읽기 명령 목록 ----------

const SIMPLE_READ_ONLY_COMMANDS = new Set([
  "ls",
  "ll",
  "pwd",
  "cat",
  "head",
  "tail",
  "wc",
  "stat",
  "file",
  "which",
  "type",
  "echo",
  "printf",
  "true",
  "false",
  "uname",
  "whoami",
  "id",
  "printenv",
  "grep",
  "egrep",
  "fgrep",
  "ag",
  "tree",
  "du",
  "df",
  "realpath",
  "dirname",
  "basename",
  "readlink",
  "uniq",
  "cut",
  "tr",
  "jq",
  "diff",
  "cmp",
  "md5sum",
  "sha256sum",
  "shasum",
]);

const FIND_UNSAFE_FLAGS = new Set([
  "-exec",
  "-execdir",
  "-ok",
  "-okdir",
  "-delete",
  "-fls",
  "-fprint",
  "-fprint0",
  "-fprintf",
]);

const GIT_READ_ONLY_SIMPLE_SUBCOMMANDS = new Set([
  "status",
  "log",
  "diff",
  "show",
  "rev-parse",
  "ls-files",
  "ls-tree",
  "blame",
  "shortlog",
  "describe",
]);

const GIT_BRANCH_UNSAFE_FLAGS = new Set([
  "-d",
  "-D",
  "-m",
  "-M",
  "-c",
  "-C",
  "-f",
  "--delete",
  "--move",
  "--copy",
  "--force",
  "--set-upstream-to",
  "--unset-upstream",
  "--edit-description",
]);

const GIT_TAG_UNSAFE_FLAGS = new Set([
  "-d",
  "-a",
  "-f",
  "-s",
  "-u",
  "-m",
  "-F",
  "--delete",
  "--annotate",
  "--force",
  "--sign",
  "--local-user",
  "--message",
  "--file",
]);

function hasUnsafeGitDiffFlags(args: readonly string[]): boolean {
  return args.some(
    (a) =>
      a === "--output" ||
      a.startsWith("--output=") ||
      a === "--ext-diff" ||
      a === "--textconv",
  );
}

function isReadOnlyGit(args: readonly string[]): boolean {
  // 안전한 전역 git option만 건너뛴다(`-c`는 임의 명령 실행 hook에 쓰일 수 있어 거부).
  let idx = 0;
  while (idx < args.length) {
    const a = args[idx];
    if (a === "-C" || a === "--git-dir" || a === "--work-tree") {
      idx += 2;
      continue;
    }
    if (
      a === "--no-pager" ||
      a === "-P" ||
      a === "--bare" ||
      a.startsWith("--git-dir=") ||
      a.startsWith("--work-tree=")
    ) {
      idx++;
      continue;
    }
    if (a.startsWith("-")) return false;
    break;
  }
  const sub = args[idx];
  if (!sub) return false;
  const rest = args.slice(idx + 1);

  if (GIT_READ_ONLY_SIMPLE_SUBCOMMANDS.has(sub)) {
    return !hasUnsafeGitDiffFlags(rest);
  }

  if (sub === "branch") {
    let hasListFlag = false;
    let expectFlagArg = false;
    for (const a of rest) {
      if (expectFlagArg) {
        expectFlagArg = false;
        continue;
      }
      if (GIT_BRANCH_UNSAFE_FLAGS.has(a)) return false;
      if (
        a.startsWith("-") &&
        !a.startsWith("--") &&
        /[dDmMcCf]/.test(a.slice(1))
      ) {
        return false;
      }
      if (
        a === "--contains" ||
        a === "--no-contains" ||
        a === "--merged" ||
        a === "--no-merged" ||
        a === "--points-at" ||
        a === "--sort" ||
        a === "--format" ||
        a === "--list" ||
        a === "-l"
      ) {
        hasListFlag = true;
        if (a !== "--list" && a !== "-l") expectFlagArg = true;
        continue;
      }
      if (a.startsWith("-")) continue;
      // list 관련 flag 없이 위치 인자를 넘기면 새 branch 생성이다.
      if (!hasListFlag) return false;
    }
    return true;
  }

  if (sub === "tag") {
    let hasListFlag = false;
    for (const a of rest) {
      if (GIT_TAG_UNSAFE_FLAGS.has(a)) return false;
      if (
        a.startsWith("-") &&
        !a.startsWith("--") &&
        /[dafsumF]/.test(a.slice(1))
      ) {
        return false;
      }
      if (a === "-l" || a === "--list" || a === "-v" || a === "--verify") {
        hasListFlag = true;
        continue;
      }
      if (a.startsWith("-")) continue;
      if (!hasListFlag) return false;
    }
    return true;
  }

  if (sub === "remote") {
    if (rest.length === 0) return true;
    if (rest.length === 1 && (rest[0] === "-v" || rest[0] === "--verbose")) {
      return true;
    }
    return rest[0] === "show";
  }

  if (sub === "config") {
    const hasReadFlag = rest.some(
      (a) =>
        a === "--get" ||
        a === "--get-all" ||
        a === "--get-regexp" ||
        a === "--list" ||
        a === "-l",
    );
    const hasWriteFlag = rest.some(
      (a) =>
        a === "--edit" ||
        a === "-e" ||
        a === "--unset" ||
        a === "--unset-all" ||
        a === "--replace-all" ||
        a === "--add" ||
        a === "--remove-section" ||
        a === "--rename-section",
    );
    return hasReadFlag && !hasWriteFlag;
  }

  if (sub === "stash") {
    return (
      rest.length > 0 &&
      (rest[0] === "list" ||
        (rest[0] === "show" && !hasUnsafeGitDiffFlags(rest.slice(1))))
    );
  }

  return false;
}

export type ShellMatchPathOptions = {
  readonly homeDir?: string;
  readonly dataRoot?: string;
};

const SENSITIVE_ARG_PATTERNS = [
  /(?:^|\/)\.ssh(?:\/|$)/,
  /(?:^|\/)\.aws(?:\/|$)/,
  /(?:^|\/)\.gnupg(?:\/|$)/,
  /(?:^|\/)\.lophn\/secrets(?:$|[./*?\[])/,
];

function isSensitiveArgCandidate(
  candidate: string,
  options?: ShellMatchPathOptions,
): boolean {
  const lower = candidate.replace(/\\/g, "/").toLowerCase();
  if (SENSITIVE_ARG_PATTERNS.some((re) => re.test(lower))) return true;
  const trimmed = lower.replace(/\/+$/, "");
  const base = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  if (
    base !== ".env.example" &&
    base !== ".env.sample" &&
    (base === ".env" ||
      base.startsWith(".env.") ||
      base.startsWith(".env*") ||
      base.startsWith(".env?") ||
      base.startsWith(".env["))
  ) {
    return true;
  }
  if (/^secrets(?:\.[^/]+)?\.json/.test(base)) {
    return true;
  }
  if (options?.dataRoot) {
    const normRoot = normalizePathTarget(options.dataRoot, options.homeDir)
      .replace(/\/+$/, "")
      .toLowerCase();
    const normTarget = normalizePathTarget(candidate, options.homeDir)
      .replace(/\/+$/, "")
      .toLowerCase();
    if (normRoot !== "" && normTarget.startsWith(`${normRoot}/`)) {
      const rel = normTarget.slice(normRoot.length + 1);
      if (
        rel === "secrets" ||
        rel.startsWith("secrets.") ||
        rel.startsWith("secrets/") ||
        rel.startsWith("secrets*")
      ) {
        return true;
      }
    }
  }
  return false;
}

function referencesHardProtectedSecret(
  words: readonly string[],
  options?: ShellMatchPathOptions,
): boolean {
  for (let idx = 1; idx < words.length; idx++) {
    const arg = words[idx];
    if (isSensitiveArgCandidate(arg, options)) return true;
    const eq = arg.indexOf("=");
    if (eq >= 0 && isSensitiveArgCandidate(arg.slice(eq + 1), options)) {
      return true;
    }
  }
  return false;
}

export function isReadOnlySegment(
  segment: ShellSegment,
  options?: ShellMatchPathOptions,
): boolean {
  if (
    segment.elevated ||
    segment.hasOutputRedirection ||
    segment.hasCommandSubstitution ||
    segment.hasDangerousEnv ||
    segment.viaEvalOrXargs
  ) {
    return false;
  }
  if (referencesHardProtectedSecret(segment.words, options)) return false;

  const cmd = segment.command;
  const args = segment.words.slice(1);

  if (cmd === "sort") {
    if (
      args.some(
        (a) =>
          a === "-o" ||
          a.startsWith("--output") ||
          (a.startsWith("-") && !a.startsWith("--") && a.includes("o")),
      )
    ) {
      return false;
    }
    return true;
  }

  if (cmd === "rg") {
    if (
      args.some(
        (a) =>
          a === "--pre" ||
          a.startsWith("--pre=") ||
          a === "--pre-glob" ||
          a.startsWith("--pre-glob="),
      )
    ) {
      return false;
    }
    return true;
  }

  if (cmd === "fd") {
    if (
      args.some(
        (a) =>
          a === "-x" ||
          a === "-X" ||
          a === "--exec" ||
          a === "--exec-batch" ||
          a.startsWith("--exec=") ||
          a.startsWith("--exec-batch=") ||
          /^-[^-]*[xX]/.test(a),
      )
    ) {
      return false;
    }
    return true;
  }

  if (cmd === "date") {
    if (args.some((a) => a === "-s" || a.startsWith("--set"))) return false;
    return true;
  }

  if (SIMPLE_READ_ONLY_COMMANDS.has(cmd)) return true;

  if (cmd === "command") {
    return args.length >= 2 && (args[0] === "-v" || args[0] === "-V");
  }

  if (cmd === "env") {
    return args.every((a) => a === "-0" || a === "--null" || a === "-i");
  }

  if (cmd === "find") {
    return !args.some((a) => FIND_UNSAFE_FLAGS.has(a));
  }

  if (cmd === "git") {
    return isReadOnlyGit(args);
  }

  return false;
}

export function isReadOnlyShellCommand(
  scan: ShellScanResult,
  options?: ShellMatchPathOptions,
): boolean {
  if (
    scan.opaque ||
    scan.elevated ||
    scan.hasOutputRedirection ||
    scan.hasDangerousEnv ||
    scan.segments.length === 0
  ) {
    return false;
  }
  // 래퍼로 감싼 `sh -c "ls"`나 `eval "ls"`는 최상위 segment가 `sh`/`eval`이라 여기서 자동으로 false가 된다.
  return scan.segments.every((seg) => isReadOnlySegment(seg, options));
}

// ---------- 규칙 평가 (floor > user deny > user ask > user allow) ----------

export function matchFloorRules(
  floor: readonly PermissionRule[],
  scan: ShellScanResult,
): PermissionRule | null {
  const shellFloor = floor.filter((r) => r.category === "shell");
  for (const candidate of scan.floorCandidates) {
    for (const rule of shellFloor) {
      if (shellRuleMatches(rule.pattern, candidate)) return rule;
    }
  }
  return null;
}

export function evaluateShellUserRules(
  layers: PermissionRuleLayers,
  scan: ShellScanResult,
  options?: ShellMatchPathOptions,
): ShellRuleEvaluation {
  const userRules = [...layers.global, ...layers.project].filter(
    (r) => r.category === "shell",
  );
  if (userRules.length === 0) {
    return { action: null, pattern: null, source: null };
  }

  const allTargets = new Set<string>(scan.floorCandidates);
  for (const seg of scan.segments) {
    if (seg.raw !== "") allTargets.add(seg.raw);
  }

  // 1. deny 최우선: 어느 조각이든 deny 규칙에 맞으면 즉시 deny.
  for (const rule of userRules) {
    if (rule.action !== "deny") continue;
    for (const text of allTargets) {
      if (shellRuleMatches(rule.pattern, text)) {
        return {
          action: "deny",
          pattern: rule.pattern,
          source: rule.source ?? null,
        };
      }
    }
  }

  // 2. ask 다음 우선: 어느 조각이든 ask 규칙에 맞으면 ask.
  for (const rule of userRules) {
    if (rule.action !== "ask") continue;
    for (const text of allTargets) {
      if (shellRuleMatches(rule.pattern, text)) {
        return {
          action: "ask",
          pattern: rule.pattern,
          source: rule.source ?? null,
        };
      }
    }
  }

  // 3. allow: opaque·elevated·출력 리다이렉션·위험 env·명령 치환·eval/xargs가 있으면 자동 허용하지 않는다.
  if (
    scan.opaque ||
    scan.elevated ||
    scan.hasOutputRedirection ||
    scan.hasDangerousEnv ||
    scan.segments.some(
      (seg) =>
        seg.hasCommandSubstitution || seg.hasDangerousEnv || seg.viaEvalOrXargs,
    )
  ) {
    return { action: null, pattern: null, source: null };
  }

  const allowRules = userRules.filter((r) => r.action === "allow");
  if (allowRules.length === 0) {
    return { action: null, pattern: null, source: null };
  }

  // 전체 문자열 단축 매칭은 쓰지 않는다(`npm test *`가 `&&`, `;`, `|`, `\n` 뒤까지 먹지 않도록).
  // 최상위·서브셸의 모든 실행 조각(`origin !== "wrapper"`)이 allow 규칙이나 내장 읽기 명령으로 덮여야 한다.
  const executableSegments = scan.segments.filter(
    (seg) => seg.origin !== "wrapper",
  );
  if (executableSegments.length === 0) {
    return { action: null, pattern: null, source: null };
  }
  let matchedAllow: PermissionRule | null = null;
  for (const seg of executableSegments) {
    const hit = allowRules.find((rule) =>
      shellRuleMatches(rule.pattern, seg.raw),
    );
    if (hit) {
      matchedAllow ??= hit;
      continue;
    }
    if (isReadOnlySegment(seg, options)) {
      continue;
    }
    return { action: null, pattern: null, source: null };
  }

  return matchedAllow
    ? {
        action: "allow",
        pattern: matchedAllow.pattern,
        source: matchedAllow.source ?? null,
      }
    : { action: null, pattern: null, source: null };
}

// ---------- 안전한 `always` 패턴과 넓은 규칙 감지 ----------

const FORBIDDEN_SINGLE_PREFIXES = new Set([
  "rm",
  "rmdir",
  "sudo",
  "doas",
  "su",
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "eval",
  "exec",
  "env",
  "xargs",
  "curl",
  "wget",
  "chmod",
  "chown",
  "chgrp",
  "mv",
  "dd",
  "mkfs",
  "fdisk",
  "parted",
  "kill",
  "pkill",
  "killall",
  "python",
  "python3",
  "node",
  "deno",
  "bun",
  "perl",
  "ruby",
  "php",
]);

const FORBIDDEN_TWO_WORD_PREFIXES = new Set([
  "git push",
  "git reset",
  "git clean",
  "git rebase",
  "git checkout",
  "git filter-branch",
  "npm publish",
  "docker run",
  "kubectl delete",
  "kubectl apply",
]);

function isForbiddenCommandWords(words: readonly string[]): boolean {
  if (words.length === 0) return true;
  const cmd = baseNameOf(words[0]);
  if (
    FORBIDDEN_SINGLE_PREFIXES.has(cmd) ||
    cmd.startsWith("mkfs.") ||
    /^python\d/.test(cmd)
  ) {
    return true;
  }
  if (words.length >= 2) {
    const second = words[1];
    if (FORBIDDEN_TWO_WORD_PREFIXES.has(`${cmd} ${second}`)) return true;
  }
  // `git -C dir push`처럼 flag 뒤에 금지 subcommand가 와도 잡는다.
  if (cmd === "git") {
    let idx = 1;
    while (idx < words.length && words[idx].startsWith("-")) {
      const f = words[idx];
      idx +=
        f === "-C" || f === "-c" || f === "--git-dir" || f === "--work-tree"
          ? 2
          : 1;
    }
    if (
      idx < words.length &&
      FORBIDDEN_TWO_WORD_PREFIXES.has(`git ${words[idx]}`)
    ) {
      return true;
    }
  }
  return false;
}

// 다단어 CLI의 subcommand 길이 표.
const THREE_WORD_SUBCOMMANDS: ReadonlyMap<
  string,
  ReadonlySet<string>
> = new Map([
  ["npm", new Set(["run"])],
  ["pnpm", new Set(["run"])],
  ["yarn", new Set(["run"])],
  [
    "docker",
    new Set(["compose", "container", "image", "volume", "network", "buildx"]),
  ],
  [
    "gh",
    new Set(["pr", "issue", "repo", "run", "workflow", "release", "gist"]),
  ],
  [
    "lophn",
    new Set([
      "app",
      "session",
      "agent",
      "workflow",
      "job",
      "project",
      "call",
      "tab",
      "browser",
      "remote",
    ]),
  ],
]);

const MULTI_WORD_CLIS = new Set([
  "git",
  "npm",
  "pnpm",
  "yarn",
  "cargo",
  "go",
  "docker",
  "kubectl",
  "lophn",
  "gh",
  "systemctl",
  "apt",
  "apt-get",
  "brew",
  "npx",
  "pnpx",
  "bunx",
]);

function isPlainSubcommandWord(word: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(word) && !word.startsWith("-");
}

function buildAlwaysPatternForSegment(segment: ShellSegment): string | null {
  const words = segment.words;
  if (words.length === 0) return null;
  if (isForbiddenCommandWords(words)) return null;

  const cmd = baseNameOf(words[0]);
  const threeSubs = THREE_WORD_SUBCOMMANDS.get(cmd);
  if (
    threeSubs &&
    words.length >= 3 &&
    threeSubs.has(words[1]) &&
    isPlainSubcommandWord(words[2])
  ) {
    return `${words[0]} ${words[1]} ${words[2]} *`;
  }

  if (MULTI_WORD_CLIS.has(cmd)) {
    if (words.length >= 2 && isPlainSubcommandWord(words[1])) {
      return `${words[0]} ${words[1]} *`;
    }
    return null;
  }

  if (words.length === 1) return words[0];
  if (isPlainSubcommandWord(words[1])) {
    return `${words[0]} ${words[1]} *`;
  }
  return `${words[0]} *`;
}

// 안전한 `always` 패턴을 만든다. opaque·elevated·여러 줄·출력 리다이렉션·위험 env·금지 접두사는 `[]`를 돌려준다.
export function alwaysPatterns(
  layers: PermissionRuleLayers,
  command: string,
  homeDir?: string,
  dataRoot?: string,
): string[] {
  const scan = scanShellCommand(command, homeDir);
  if (
    scan.opaque ||
    scan.elevated ||
    scan.multiline ||
    scan.hasOutputRedirection ||
    scan.hasDangerousEnv ||
    scan.segments.length === 0
  ) {
    return [];
  }
  if (matchFloorRules(layers.floor, scan) !== null) return [];
  const pathOpts: ShellMatchPathOptions = { homeDir, dataRoot };
  const userVerdict = evaluateShellUserRules(layers, scan, pathOpts);
  if (userVerdict.action === "deny") return [];

  // 어느 조각이든 금지 접두사·command substitution·위험 env·eval/xargs면 always를 열지 않는다.
  for (const seg of scan.segments) {
    if (
      seg.hasCommandSubstitution ||
      seg.hasDangerousEnv ||
      seg.viaEvalOrXargs ||
      isForbiddenCommandWords(seg.words)
    ) {
      return [];
    }
  }

  const executableSegments = scan.segments.filter(
    (seg) => seg.origin !== "wrapper",
  );
  const out: string[] = [];
  for (const seg of executableSegments) {
    if (isReadOnlySegment(seg, pathOpts)) continue;
    // 이미 user allow 규칙에 덮인 조각은 다시 더하지 않는다.
    const alreadyAllowed = [...layers.global, ...layers.project].some(
      (r) =>
        r.category === "shell" &&
        r.action === "allow" &&
        shellRuleMatches(r.pattern, seg.raw),
    );
    if (alreadyAllowed) continue;
    const pattern = buildAlwaysPatternForSegment(seg);
    if (pattern === null) return [];
    out.push(pattern);
  }
  return [...new Set(out)];
}

// Settings 화면이 기존 저장 규칙 가운데 지나치게 넓은 규칙(`rm -rf *`, `sudo *`, `git *`, `*` 등)에
// 경고 배지를 달기 위해 쓴다(규칙을 지우지 않는다).
export function isBroadRulePattern(pattern: string): boolean {
  const norm = normalize(pattern);
  if (norm === "" || norm === "*" || norm === "**") return true;
  const words = norm.split(" ");
  const head = words[0];
  if (head.includes("*")) return true;
  const cmd = baseNameOf(head);
  if (
    FORBIDDEN_SINGLE_PREFIXES.has(cmd) ||
    cmd.startsWith("mkfs.") ||
    /^python\d/.test(cmd)
  ) {
    return true;
  }
  if (words.length >= 2) {
    const second = words[1];
    if (FORBIDDEN_TWO_WORD_PREFIXES.has(`${cmd} ${second}`)) return true;
    // `git *`, `npm *`, `docker *`처럼 다단어 CLI의 subcommand 없이 `*`만 붙인 규칙.
    if (MULTI_WORD_CLIS.has(cmd) && (second === "*" || second === "**")) {
      return true;
    }
  }
  return false;
}
