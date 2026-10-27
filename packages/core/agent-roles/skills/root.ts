// 내장 skill 폴더다. 설치 묶음에 함께 간다. 읽기 허락과 skill 발견이 같은 값을 쓴다.
export const BUNDLED_SKILLS_ROOT = new URL(
  ".",
  import.meta.url,
).pathname.replace(/\/$/, "");
