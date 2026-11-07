// 쓰는 중인 agent 글. 저장되기 전의 model 호출 하나를 chat markdown으로 그린다. 글이 자라는 속도는 ACP 갱신을
// 알리는 쪽(acp-updates-store의 STREAM_PUBLISH_MS)이 정한다. 닫히지 않은 code fence는 그릴 때만 닫아 code block으로 보인다.
// reasoning이 있으면 글 위에 reasoning 줄을 두고, 아직 글이 없으면 그 줄만 그린다.
import { memo, useEffect, useReducer, useRef } from "react";
import type { ArtifactsSlice } from "../../workspace/kinds/host.ts";
import type { AcpWriting } from "../../../../protocol/acp/mod.ts";
import { Said } from "./agent-turn.tsx";
import { ChatMarkdown } from "./chat-markdown.tsx";
import { Reasoning } from "./reasoning.tsx";
import { closeOpenFence, openFenceContent, splitLive } from "../live-text.ts";

// 끝난 block 묶음. 글이 같으면 다시 그리지 않는다.
const DoneChunk = memo(ChatMarkdown);

// 긴 글은 store가 알리는 40ms마다가 아니라 이 간격으로만 다시 그린다. 글이 길수록 한 번 그리는 값이 커진다.
const LONG_TEXT = 8000;
const LONG_PUBLISH_MS = 120;

// 긴 글의 갱신을 trailing으로 묶는다. 시계 없이 timer 하나만 쓴다: 대기 중이 아니면 timer를 걸고, 울리면 가장 새 글을 보인다.
function usePacedText(text: string): string {
  const shown = useRef(text);
  const latest = useRef(text);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const long = text.length > LONG_TEXT;
  latest.current = text;
  if (!long) shown.current = text;
  useEffect(() => {
    if (!long || timer.current !== undefined) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      shown.current = latest.current;
      redraw();
    }, LONG_PUBLISH_MS);
  }, [text, long]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return shown.current;
}

export const LiveMessage = memo(function LiveMessage({
  live,
  reasoning,
  artifacts,
}: {
  live: AcpWriting;
  reasoning: boolean;
  artifacts: ArtifactsSlice | undefined;
}) {
  const text = usePacedText(live.text);
  const { done, tail } = splitLive(text);
  return (
    <Said>
      <div data-live="">
        {reasoning && live.reasoning !== "" ? (
          <Reasoning
            text={closeOpenFence(live.reasoning)}
            durationMs={null}
            thinking={live.text === ""}
            artifacts={artifacts}
          />
        ) : null}
        {done.map((chunk, index) => (
          // 묶음마다 markdown root가 따로라 마지막 block의 아래 여백이 없어진다. 묶음 사이 여백을 여기서 준다.
          <div key={index} style={{ marginBottom: "var(--space-5)" }}>
            <DoneChunk text={chunk} artifacts={artifacts} />
          </div>
        ))}
        {tail === "" ? null : (
          <ChatMarkdown
            text={closeOpenFence(tail)}
            openFence={openFenceContent(tail)}
            streaming
            artifacts={artifacts}
          />
        )}
      </div>
    </Said>
  );
});
