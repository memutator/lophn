// runtime이 stderr·turn 기록에 쓰기 전에 secret 형태를 거른다. credential 값과 secret 형태는 남기지 않는다.
const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /sk-[A-Za-z0-9]{8,}/g,
  /gh[pousr]_[A-Za-z0-9]{8,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /xox[baprs]-[A-Za-z0-9-]{8,}/g,
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g,
  // 헤더 한 줄 전체를 가린다. 값 하나만 지우면 뒤 토큰이 남는다.
  /authorization\s*[:=][^\n]*/gi,
  /:\/\/[^/\s]+@/g,
];

export function redact(text: string): string {
  let next = text;
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    next = next.replace(pattern, "[redacted]");
  }
  return next;
}
