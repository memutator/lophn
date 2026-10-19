// artifact 탭 화면. 진짜 Workspace가 artifact 탭을 가진 layout을 읽어 그린다. page는 main의 native view(`lophn-artifact:` 문서)라
// gallery에는 없어서, 탭이 view에 내주는 자리(`[data-artifact-page]`) 안에 `spending` artifact의 고정 그림을 넣는다.
// 폴더 없음은 fake artifact 통로 설정으로, annotate 켜짐은 mount 뒤 [Annotate]를 눌러 만든다.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "@lophn/wording";

import { openProject } from "../../../../../packages/shell/renderer/desktop/router.ts";
import { fakeArtifactApi } from "../../../../../packages/shell/renderer/artifact/testdata/fake-artifact-api.ts";
import { fakeAnnotate } from "../../../../../packages/shell/renderer/app-frame/testdata/fake-annotate.ts";
import type { AnnotateState } from "../../../../../packages/shell/ipc/annotation.ts";
import {
  MockDesktop,
  type PaneSpec,
  PROJECT_GROCERY,
} from "../../../mock/mock-desktop.tsx";
import {
  ANNOTATIONS,
  ARTIFACTS,
  FILE_TAB,
  SPENDING,
} from "../../../mock/artifact/data.ts";
import { SpendingView } from "../../../mock/artifact/spending-view.tsx";
import { click, useDrive } from "../../../mock/drive.ts";

const NAMED = {
  key: `artifact:${PROJECT_GROCERY}:${SPENDING.name}`,
  kind: "artifact",
  title: SPENDING.name,
  name: SPENDING.name,
} as const;
const FILE = {
  key: `artifact-file:${FILE_TAB.path}`,
  kind: "artifact",
  title: FILE_TAB.title,
  path: FILE_TAB.path,
} as const;

const PANES = {
  named: [{ tabs: [NAMED], selected: NAMED.key }],
  file: [{ tabs: [FILE], selected: FILE.key }],
} as const satisfies Record<string, readonly PaneSpec[]>;

// 고른 막대의 표지. annotate가 켜져 있는 동안만 보인다(번호는 모은 목록의 n이다).
const PICKED = {
  Dining: { n: 1, memo: ANNOTATIONS[0]!.note },
  Rent: { n: 2 },
};

export function ArtifactScene(
  { tab, missing = false, annotate = false }: {
    tab: keyof typeof PANES;
    missing?: boolean;
    annotate?: boolean;
  },
) {
  const title = tab === "file" ? FILE_TAB.title : SPENDING.title;
  const fakes = useMemo(() => ({
    artifact: fakeArtifactApi({ missing, artifacts: [...ARTIFACTS], title }),
    annotate: fakeAnnotate({ items: annotate ? ANNOTATIONS : [] }),
  }), []);
  const [region, setRegion] = useState<HTMLElement | null>(null);
  const [annotating, setAnnotating] = useState<AnnotateState | null>(null);
  useEffect(() => fakes.annotate.subscribeState(setAnnotating), [fakes]);

  useDrive(async () => {
    if (annotate) {
      await click(
        "[data-artifact-toolbar] button",
        t("artifact.button.annotate"),
      );
    }
  });
  // 탭이 mount되면 view 자리가 생긴다.
  useEffect(() => {
    const timer = setInterval(() => {
      const found = document.querySelector<HTMLElement>(
        "[data-artifact-page]",
      );
      if (found !== null) {
        setRegion(found);
        clearInterval(timer);
      }
    }, 25);
    return () => clearInterval(timer);
  }, []);

  return (
    <>
      <MockDesktop
        route={openProject(PROJECT_GROCERY)}
        panes={PANES[tab]}
        artifact={fakes.artifact.api}
        annotate={fakes.annotate}
      />
      {region === null || missing ? null : createPortal(
        <div
          style={{
            position: "absolute",
            inset: 0,
            overflow: "auto",
            background: "var(--color-surface-base)",
          }}
        >
          <SpendingView
            title={title}
            picked={annotating?.on
              ? Object.fromEntries(
                Object.entries(PICKED).filter(([, mark]) =>
                  annotating.items.some((item) => item.n === mark.n)
                ),
              )
              : {}}
          />
        </div>,
        region,
      )}
    </>
  );
}
