// home 같이 폴더 없는 workspace의 harness session이 cwd로 쓰는 빈 폴더다(`tool-results`처럼 data root 아래 session마다 하나).
// 지우지 않는다.
export const HARNESS_HOME_FOLDER = "harness-home";

export function harnessHomeName(session: string): string {
  return `${HARNESS_HOME_FOLDER}/${session}`;
}
