// context.hand_off_violations가 Context Engineer에게 보내는 요청 글을 만든다. 사람이 쓴 글이 아니라
// 서버가 붙인 근거(contexts.md 정책 "근거")를 글로 옮긴 것이다: 파일 경로·section·규칙·현재 규칙 정의만
// 담고 문서 판이나 `doc@ver` 주소는 담지 않는다. 순수 함수라 ledger 연결 없이 시험한다.

// 사람 요청 본문의 상한(64KiB)보다 훨씬 작게 잡아, 위반이 많아도 글이 넘치지 않는다. 넘치면 남은
// 위반은 개수만 알리고 context.violations로 읽게 한다.
export const REQUEST_TEXT_MAX_BYTES = 48 * 1024;

type Entry = Record<string, unknown>;

const isEntry = (value: unknown): value is Entry =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function field(entry: Entry, name: string): string | null {
  const value = entry[name];
  return typeof value === "string" ? value : null;
}

function describe(entry: Entry, order: number): string {
  const rule = field(entry, "rule");
  const section = field(entry, "section");
  const target = field(entry, "target");
  const lines = [
    `${order}. ${field(entry, "kind") ?? "violation"}${
      rule === null ? "" : ` ${rule}`
    } at ${field(entry, "path") ?? "(no path)"}${
      section === null ? "" : ` section "${section}"`
    }${target === null ? "" : ` (${target})`}`,
  ];
  const message = field(entry, "message");
  if (message !== null) lines.push(`   ${message}`);
  const definition = entry["rule_definition"];
  if (definition !== null && definition !== undefined) {
    lines.push(`   rule definition: ${JSON.stringify(definition)}`);
  }
  return lines.join("\n");
}

const bytes = (text: string) => new TextEncoder().encode(text).length;

export function violationRequestText(evidence: Entry): string {
  const context = field(evidence, "context") ?? "(unknown)";
  const listed = Array.isArray(evidence["violations"])
    ? evidence["violations"].filter(isEntry)
    : [];
  const head = [
    `Look at the contract violations of context ${context}.`,
    "",
    "For each one, decide whether the contract should change or the document is wrong, and report it.",
    "Read the contract with context.read_contract and the current violations with context.violations.",
    "Do not edit the documents.",
    "",
    `Violations handed off (${listed.length}):`,
  ].join("\n");
  const parts = [head];
  let used = bytes(head);
  let shown = 0;
  for (const [index, entry] of listed.entries()) {
    const line = describe(entry, index + 1);
    const cost = bytes(line) + 1;
    if (used + cost > REQUEST_TEXT_MAX_BYTES) break;
    parts.push(line);
    used += cost;
    shown += 1;
  }
  if (shown < listed.length) {
    parts.push(
      `... and ${
        listed.length - shown
      } more; read them with context.violations.`,
    );
  }
  return parts.join("\n");
}

// 요청 message의 본문 값이다(글 하나). 호출 경계(contexts-blob.ts)가 이 값의 bytes를 미리 준비하고,
// command가 같은 값에서 같은 hash를 만들어 등록한다.
export function handOffContent(evidence: Entry) {
  return {
    schema_version: 1 as const,
    parts: [{ kind: "text" as const, text: violationRequestText(evidence) }],
  };
}
