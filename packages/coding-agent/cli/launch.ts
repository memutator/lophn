// CLI 실행 argv의 권한 계산이다.
// 일반 CLI는 core loopback network와 읽기뿐이고 쓰기가 없다.
// 명령 시점에야 알 수 있는 권한은 그 명령에만 정확한 경로로 더한다: `harness install`은 고른 harness의
// 전역 위치(hook 설정 폴더와 skill 폴더, home 기준)의 읽기·쓰기, `harness refresh`는 감지가 찾은 제품
// 실행 파일의 실행. `-A`·일반 `--allow-write`·`--allow-run`, 와일드카드는 없다.
import { HARNESS_ADAPTERS } from "../../protocol/coding-agent/mod.ts";

// 실행 entry의 설치 resource root 기준 경로다.

// CLI가 읽는 환경 이름이다.

// 명령 시점에 입력에서 계산한 정확한 경로다.
type CliSelection = {
  // `harness install`이 쓰는 그 harness의 전역 폴더들이다. 이 경로들의 읽기·쓰기만 열린다.
  paths: readonly string[];
};

const NO_SELECTION: CliSelection = { paths: [] };

export function exactPath(path: string): boolean {
  return path.startsWith("/") && !path.split("/").includes("..") &&
    !/[\0\n,]/.test(path);
}

// 선택이 더하는 읽기·쓰기 flag다. 선택이 없으면 비어 있다.
export function selectionFlags(selection: CliSelection): string[] {
  const paths = selection.paths.filter(exactPath);
  if (paths.length === 0) return [];
  const list = paths.join(",");
  return [`--allow-read=${list}`, `--allow-write=${list}`];
}

// 선택과 상관없이 고정인 권한이다.

// 실행 argv를 분리 배열로 만든다. shell 문자열로 합치지 않는다.

// 이 입력이 더 열 정확한 경로를 계산한다. 계산하지 못하면 아무것도 더하지 않는다(그 command는 권한이
// 없어 unavailable로 끝난다).
export function planSelection(
  command: string,
  input: Record<string, unknown>,
  home: string,
): CliSelection {
  if (command !== "harness install") return NO_SELECTION;
  const adapter = Object.values(HARNESS_ADAPTERS).find((one) =>
    one.id === input.harness
  );
  if (adapter === undefined) return NO_SELECTION;
  const base = home.replace(/\/+$/, "");
  const paths = [
    ...(adapter.hook === null
      ? []
      : [`${base}/${adapter.hook.path.split("/").slice(0, -1).join("/")}`]),
    ...(adapter.skill_dir === null ? [] : [`${base}/${adapter.skill_dir}`]),
  ];
  return { paths: paths.filter(exactPath) };
}
