// 질문 선택지가 바꿀 수 없는 설정. 권한 확대·secret 등록·외부 효과는
// 사람이 소유 concern의 보호 화면에서 직접 한다. question option action은 되돌릴 수 있는 lophn
// 안쪽 동작만 고정하므로 이런 설정 key는 action으로 열지 않고 보호 화면을 안내한다.
//
// 판정은 key만 본다. 질문을 만드는 쪽(create_question)과 선택지를 만드는 쪽(lophn 역할)이 같은
// 규칙을 쓰려고 이 파일 하나에 둔다. 모르는 key는 일반 설정이다: 등록된 공개 설정은 secret 값을
// 담지 않으므로(platform/settings), 이 규칙은 key 이름에 드러난 위험 종류만 거른다.

export type ProtectedSettingKind = "secret" | "permission" | "external";

export type ProtectedSetting = {
  kind: ProtectedSettingKind;
  // 사람이 직접 확인하는 보호 화면의 소유 concern.
  screen: string;
};

// 외부 서버·외부 도구·coding agent 설정 파일을 건드리는 설정의 key 접두사.
const EXTERNAL_PREFIXES: readonly { prefix: string; screen: string }[] = [
  { prefix: "lophn-agent.extensions.", screen: "lophn-agent/extensions" },
  { prefix: "coding-agent.", screen: "coding-agent/harnesses" },
];

const KEYWORDS: readonly {
  pattern: RegExp;
  kind: ProtectedSettingKind;
  screen: string;
}[] = [
  {
    pattern: /(secret|credential|token|password|api[_-]?key)/i,
    kind: "secret",
    screen: "platform/secrets",
  },
  {
    pattern: /(grant|permission|approval)/i,
    kind: "permission",
    screen: "apps/permissions",
  },
];

export function protectedSetting(key: string): ProtectedSetting | null {
  for (const { pattern, kind, screen } of KEYWORDS) {
    if (pattern.test(key)) return { kind, screen };
  }
  for (const { prefix, screen } of EXTERNAL_PREFIXES) {
    if (key.startsWith(prefix)) return { kind: "external", screen };
  }
  return null;
}
