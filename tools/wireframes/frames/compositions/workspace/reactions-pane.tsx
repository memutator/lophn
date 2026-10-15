// Settings › Reactions. 옮긴 renderer Reactions panel을 fake 통로로 그린다. 새 일을 여는 domain event 다섯마다
// Off, Open without asking, Ask를 고른다.
import { useMemo } from "react";

import { SettingsScreen } from "../../../../../packages/shell/renderer/desktop/lophn-space/settings/settings-screen.tsx";
import {
  fakeReactions,
  SAMPLE_MODES,
} from "../../../../../packages/shell/renderer/desktop/lophn-space/settings/reactions/testdata/fake-source.ts";
import { fakeSettings } from "../../../../../packages/shell/renderer/desktop/lophn-space/settings/testdata/fake-settings.ts";

export function ReactionsPane() {
  const sources = useMemo(
    () => ({
      source: fakeSettings().source,
      reactions: fakeReactions({ modes: SAMPLE_MODES }).source,
    }),
    [],
  );
  return <SettingsScreen pane="reactions" onPane={() => {}} {...sources} />;
}
