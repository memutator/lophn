// Lophn Workspace › Apps. 화면은 renderer의 AppsScreen이 그리고 여기서는 fake source에 이어 준다. 목록과
// 보관·다시 꺼내기뿐이고 앱 등록은 이 화면의 일이 아니다.
import { useMemo } from "react";

import { AppsScreen as Screen } from "../../../../../packages/shell/renderer/desktop/lophn-space/apps/apps-screen.tsx";
import { galleryApps } from "../../../../../packages/shell/renderer/desktop/lophn-space/apps/testdata/fake-apps.ts";

export function AppsScreen() {
  const source = useMemo(() => galleryApps().source, []);
  return <Screen source={source} onOpen={() => {}} />;
}
