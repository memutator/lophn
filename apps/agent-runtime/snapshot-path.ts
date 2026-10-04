// 동봉 catalog snapshot의 모듈 상대 자리(dispatch된 bundle root 기준).
// agent-runtime entry와 같은 폴더 아래에서 해석한다.
export const SNAPSHOT_ENTRY_PATH = new URL(
  "../../packages/lophn-agent/harness/model/snapshot.json",
  import.meta.url,
).pathname;
