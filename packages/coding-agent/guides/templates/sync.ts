// sync-tools가 바꾸는 관리 구간 body다(guides#R14·R17, T34). sync-tools 갱신은 이 표가
// 가리키는 body.md 원본의 몸통으로만 관리 구간(마커 쌍 안쪽)을 두고 바깥 사람 내용을
// bytes 그대로 둔다(managed-files). 각 body는 특정 몫이다:
// - `app_guide`: 앱 root 정본 `AGENTS.md`의 lophn 관리 구간이다(R13·R14). 본문은 앱
//   설명·필요 skill·시작 summary·사람 지시 claim·설계와 blueprint와 구현·machine 생성물
//   구별·수정 주의·용어·SDK 확인·문제 보고·테스트·preview·결과 반환만 담는다(R14). 변하는
//   ticket 본문·수리 묶음·token 원문은 없다.
// - `thin_claude`: Claude Code의 얇은 import 안내다(R13). 규칙 본문을 복제하지 않고
//   `@AGENTS.md`로만 정본을 가리킨다.
// - `app_ignore`: 소스의 ignore 안내다(R19). local hook 설정·wrapper·skill 사본이 commit
//   하지 않게 local 파일을 ignore한다.
export const SYNC_REGIONS = {
  app_guide: "app-root-guide.body.md",
  thin_claude: "thin-claude.body.md",
  app_ignore: "app-ignore.body.md",
} as const;

export type SyncRegion = keyof typeof SYNC_REGIONS;
