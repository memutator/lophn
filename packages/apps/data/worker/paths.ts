// 앱 데이터 영역의 경로 경계(apps/data 정책 "writer").
// data worker가 여는 경로는 앱 데이터 영역 안이어야 한다. 영역 밖은 없는 것과 같다.

import { err, ok, type Result } from "../../../base/mod.ts";

// 앱 데이터 영역 안의 상대 경로. 절대 경로·상위 탈출·빈 segment는 거절한다.
export function insideDataArea(
  dataArea: string,
  relative: string,
): Result<string> {
  if (relative.length === 0 || relative.startsWith("/")) {
    return err({ code: "invalid_input", message: "path leaves the data area" });
  }
  const segments = relative.split("/");
  if (
    segments.some((segment) =>
      segment.length === 0 || segment === "." || segment === ".."
    )
  ) {
    return err({ code: "invalid_input", message: "path leaves the data area" });
  }
  return ok(`${dataArea}/${relative}`);
}

// 해석된 절대 경로가 데이터 영역 경계 안에 있는지. symlink를 따라간 결과도 같다.
export function contained(dataArea: string, resolved: string): boolean {
  const root = dataArea.endsWith("/") ? dataArea : `${dataArea}/`;
  return resolved === dataArea || resolved.startsWith(root);
}
