// CLI 실행 argv의 권한 계산이다.
// 일반 CLI는 core loopback network와 읽기뿐이고 쓰기가 없다.
// 명령 시점에야 알 수 있는 권한은 그 명령에만 정확한 경로로 더한다: `harness install`은 고른 앱 source 폴더
// 하나의 읽기·쓰기, `harness refresh`는 감지가 찾은 제품 실행 파일의 실행. `-A`·일반 `--allow-write`·
// `--allow-run`, 와일드카드는 없다.

// 실행 entry의 설치 resource root 기준 경로다.

// CLI가 읽는 환경 이름이다.

// 명령 시점에 입력에서 계산한 정확한 경로다.
type CliSelection = {
  // `harness install`의 앱 source 폴더다. 이 폴더 하나의 읽기·쓰기만 열린다.
  folders: readonly string[];
};

const NO_SELECTION: CliSelection = { folders: [] };

export function exactPath(path: string): boolean {
  return path.startsWith("/") && !path.split("/").includes("..") &&
    !/[\0\n,]/.test(path);
}

// 선택이 더하는 읽기·쓰기 flag다. 선택이 없으면 비어 있다.
export function selectionFlags(selection: CliSelection): string[] {
  const folders = selection.folders.filter(exactPath);
  if (folders.length === 0) return [];
  const list = folders.join(",");
  return [`--allow-read=${list}`, `--allow-write=${list}`];
}

// 선택과 상관없이 고정인 권한이다.

// 실행 argv를 분리 배열로 만든다. shell 문자열로 합치지 않는다.

// 이 입력이 더 열 정확한 경로를 계산한다. 계산하지 못하면 아무것도 더하지 않는다(그 command는 권한이
// 없어 unavailable로 끝난다).
export function planSelection(
  command: string,
  input: Record<string, unknown>,
): CliSelection {
  if (command === "harness install" && typeof input.folder === "string") {
    return exactPath(input.folder)
      ? { folders: [input.folder.replace(/\/+$/, "")] }
      : NO_SELECTION;
  }
  return NO_SELECTION;
}
