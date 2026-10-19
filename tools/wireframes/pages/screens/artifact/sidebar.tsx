// project sidebar의 Artifacts 탭. 진짜 Workspace의 sidebar에서 Artifacts 탭을 눌러 둔 모양이다.
// 목록은 fake artifact 통로(`fakeArtifactApi`)가 domain마다 준다. fake project는 domain이 둘이다.
// domain이 하나뿐인 모양은 MockDesktop이 fake source의 domain을 바꿀 길이 없어 ArtifactPanel을 직접 그린다.
import { useMemo } from "react";

import { openProject } from "../../../../../packages/shell/renderer/desktop/router.ts";
import { fakeArtifactApi } from "../../../../../packages/shell/renderer/artifact/testdata/fake-artifact-api.ts";
import { ArtifactApiProvider } from "../../../../../packages/shell/renderer/artifact/artifact-api.tsx";
import { FAKE_DOMAINS } from "../../../../../packages/shell/renderer/workspace/fake-source.ts";
import { ArtifactPanel } from "../../../../../packages/shell/renderer/workspace/sidebar/artifact-panel.tsx";
import { MockDesktop, PROJECT_GROCERY } from "../../../mock/mock-desktop.tsx";
import { ARTIFACTS, RESEARCH_ARTIFACTS } from "../../../mock/artifact/data.ts";
import { click, useDrive } from "../../../mock/drive.ts";

const [FINANCES, RESEARCH] = FAKE_DOMAINS;

export function ArtifactSidebar({ empty = false }: { empty?: boolean }) {
  const artifact = useMemo(
    () =>
      fakeArtifactApi({
        perDomain: empty ? {} : {
          [FINANCES!.id]: ARTIFACTS,
          [RESEARCH!.id]: RESEARCH_ARTIFACTS,
        },
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

/** domain이 하나뿐인 project: 묶음 제목 없이 한 줄 목록이다. */
export function ArtifactSidebarSingle() {
  const artifact = useMemo(
    () => fakeArtifactApi({ perDomain: { [FINANCES!.id]: ARTIFACTS } }).api,
    [],
  );
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        padding: "var(--space-8)",
        background: "var(--color-surface-base)",
      }}
    >
      <div style={{ width: 320 }}>
        <ArtifactApiProvider value={artifact}>
          <ArtifactPanel domains={[FINANCES!]} onOpen={() => {}} />
        </ArtifactApiProvider>
      </div>
    </div>
  );
}
