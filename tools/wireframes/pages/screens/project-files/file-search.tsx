// project 키워드 검색 탭. renderer의 FileSearch를 fake 통로로 그린다. 검색어와 폴더 하나로 좁히기,
// 경로 순·줄 순 결과, 일치한 부분이 든 snippet을 보이고 결과를 누르면 그 줄에서 파일이 열린다.
import { FileSearch as SearchScreen } from "../../../../../packages/shell/renderer/workspace/search/file-search.tsx";
import { fakeFileSearchSource } from "../../../../../packages/shell/renderer/workspace/search/fake-source.ts";
import { fakeWorkspaceSource } from "../../../../../packages/shell/renderer/workspace/fake-source.ts";

import { documentTab } from "../../../mock/phroner-data.ts";
import type { TabSpec } from "../project-window.tsx";
import { fileKey, PROJECT_DIR } from "../../../mock/project-files/file-data.ts";

const WORKSPACE = fakeWorkspaceSource();
const SEARCH = fakeFileSearchSource();

export function FileSearch({
  open,
  initialQuery = "",
  initialFolder,
  opened,
}: {
  open: (tab: TabSpec, other?: boolean) => void;
  initialQuery?: string;
  /** 첫 연결 폴더 안의 하위 폴더(상대 경로). 없으면 모든 폴더다. */
  initialFolder?: string;
  /** 방금 연 결과(경로:줄)를 눌린 모양으로 보인다. */
  opened?: string;
}) {
  return (
    <SearchScreen
      project="prj_gallery"
      workspace={WORKSPACE}
      search={SEARCH}
      initialQuery={initialQuery}
      initialFolder={
        initialFolder === undefined || initialFolder === "All folders"
          ? ""
          : `${PROJECT_DIR}/${initialFolder}`
      }
      initialOpened={
        opened === undefined ? undefined : `${PROJECT_DIR}/${opened}`
      }
      onOpen={(path, line) => open(documentTab(fileKey(path), { line }))}
    />
  );
}
