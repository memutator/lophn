// 내장 skill 폴더다. 설치 묶음에 함께 간다. 읽기 허락과 skill 발견이 같은 값을 쓴다.
import { platformPath } from "../../install-and-update/mod.ts";
export const BUNDLED_SKILLS_ROOT = platformPath(
  import.meta.url,
  "packages",
  "core",
  "agent-workspaces",
  "skills",
);
