// 용어집: renderer의 `ContextGlossary`를 fake 통로로 그린다. 사람과 Project Manager가 용어의 뜻을 정하고
// 고친다. 사람은 줄에서 바로 더하고, 고치고, 지운다(지우기만 확인 창을 거친다).
import { useState } from "react";

import { ContextGlossary } from "../../../../../packages/shell/renderer/workspace/contexts/context-glossary.tsx";
import {
  createFakeContextsSource,
  EVAL,
} from "../../../../../packages/shell/renderer/workspace/contexts/fake-source.ts";
import { newId } from "../../../../../packages/shell/renderer/desktop/lophn-space/model.ts";
import { useClicks } from "./clicks.ts";

export type GlossaryDemo = "add" | "edit" | "delete";

/** 시연 상태까지 사람이 누르는 단추. 고치기와 지우기는 첫 용어의 줄이다. */
export const DEMO_CLICKS: Readonly<Record<GlossaryDemo, readonly string[]>> = {
  add: ["[data-glossary-add]"],
  edit: ["[data-glossary-edit]"],
  delete: ["[data-glossary-delete]"],
};

export function Glossary({ demo }: { demo?: GlossaryDemo }) {
  const [source] = useState(() => createFakeContextsSource());
  const ref = useClicks(demo === undefined ? [] : DEMO_CLICKS[demo]);
  return (
    <div ref={ref}>
      <ContextGlossary
        source={source}
        context={EVAL}
        newId={() => newId("trm")}
        now={new Date("2026-10-12T09:00:00.000Z")}
      />
    </div>
  );
}
