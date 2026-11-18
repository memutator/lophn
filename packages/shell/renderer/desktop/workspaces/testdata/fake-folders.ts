// 다른 기계의 폴더 목록(`projects/browse`) 가짜. 그 기계의 home(/home/mina) 아래 몇 폴더를 메모리에 둔다.
import type { BrowseFolders } from "../folder-browser.tsx";

const HOME = "/home/mina";

const TREE: Readonly<Record<string, readonly string[]>> = {
  [HOME]: ["Documents", "Downloads", "notes", "projects"],
  [`${HOME}/Documents`]: ["receipts", "taxes"],
  [`${HOME}/projects`]: ["grocery", "orders-api", "trip-planner", "website"],
};

export function fakeBrowseFolders(): BrowseFolders {
  return (path) => {
    const at = path ?? HOME;
    return Promise.resolve({
      ok: true,
      value: {
        path: at,
        parent: at === HOME ? null : at.slice(0, at.lastIndexOf("/")),
        entries: (TREE[at] ?? []).map((name) => ({
          name,
          path: `${at}/${name}`,
        })),
        truncated: false,
      },
    });
  };
}
