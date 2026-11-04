// project sidebar의 Artifacts 탭. 진짜 Workspace의 sidebar에서 Artifacts 탭을 눌러 둔 모양이다.
// 목록은 fake artifact 통로(`fakeArtifactApi`)가 준다.
import { useMemo } from "react";

import { openProject } from "../../../../../packages/shell/renderer/desktop/router.ts";
import { fakeArtifactApi } from "../../../../../packages/shell/renderer/artifact/testdata/fake-artifact-api.ts";
import { MockDesktop, PROJECT_GROCERY } from "../../../mock/mock-desktop.tsx";
import { ARTIFACTS, RESEARCH_ARTIFACTS } from "../../../mock/artifact/data.ts";
import { click, useDrive } from "../../../mock/drive.ts";

export function ArtifactSidebar({ empty = false }: { empty?: boolean }) {
  const artifact = useMemo(
    () =>
      fakeArtifactApi({
        artifacts: empty ? [] : [...ARTIFACTS, ...RESEARCH_ARTIFACTS],
      }).api,
    [],
  );
  useDrive(async () => {
    await click('[data-tab-key="artifact"]');
  });
  return (
    <MockDesktop route={openProject(PROJECT_GROCERY)} artifact={artifact} />
  );
}
