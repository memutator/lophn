import type {
  ShellRule,
  ShellRuleLayers,
} from "../../../protocol/approvals/mod.ts";

export type ShellVerdict = {
  action: ShellRule["action"];
  pattern: string | null;
};

// 공백을 줄여 맞춘다. `rm  -rf /`처럼 공백 하나 더한 것으로 floor를 비켜 가지 않게 한다.
export function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

// 따옴표와 escape를 풀지 않는다(명령 parser 없음). 줄바꿈은 shell에서 `;`와 같아 나눈다.
// 한 개 `&`는 `2>&1`이 쪼개지므로 나누지 않는다.
export function shellPieces(command: string): string[] {
  return command
    .split(/&&|\|\||;|\||\n/)
    .map(normalize)
    .filter((piece) => piece !== "");
}

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
  // 끝의 ` *`는 없어도 맞는다. always가 더한 `git status *`가 `git status` 자신에 맞아야 다시 묻지 않는다.
  const source = normalized.endsWith(" *")
    ? `${toSource(normalized.slice(0, -2))}( .*)?`
    : toSource(normalized);
  return new RegExp(`^${source}$`).test(normalize(text));
}

export function shellVerdict(
  shell: ShellRuleLayers,
  text: string,
): ShellVerdict {
  const floor = shell.floor.find((rule) =>
    shellRuleMatches(rule.pattern, text),
  );
  if (floor) return { action: "deny", pattern: floor.pattern };
  let found: ShellVerdict = { action: "allow", pattern: null };
  for (const rule of shell.layers.flat()) {
    if (shellRuleMatches(rule.pattern, text)) {
      found = { action: rule.action, pattern: rule.pattern };
    }
  }
  return found;
}

// `always`가 더할 allow 규칙의 pattern. ask였던 조각마다 앞 두 낱말 + ` *`, 한 낱말은 그대로다.
// 명령 안에 `*`가 있으면 그 `*`도 wildcard로 읽힌다. 규칙은 실수를 줄일 뿐 경계가 아니다.
export function alwaysPatterns(
  shell: ShellRuleLayers,
  command: string,
): string[] {
  const pieces = shellPieces(command);
  const out: string[] = [];
  for (const piece of pieces) {
    if (shellVerdict(shell, piece).action !== "ask") continue;
    const words = piece.split(" ");
    out.push(words.length === 1 ? piece : `${words[0]} ${words[1]} *`);
  }
  // 조각을 이어야 맞는 규칙(`curl * | sh *`)은 조각 줄만으로는 남아서 같은 명령을 다시 묻는다.
  // 두 낱말로 줄이면 `curl -fsSL *`가 다른 주소의 `| sh`까지 열므로 명령 전체를 그대로 더한다.
  const whole = normalize(command);
  if (pieces.length > 1 && shellVerdict(shell, whole).action === "ask") {
    out.push(whole);
  }
  return [...new Set(out)];
}
