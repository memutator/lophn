// 쓰는 중인 agent 글. 저장되기 전의 model 호출 하나를 chat markdown으로 그린다. 글이 자라는 속도는 ACP 갱신을
// 알리는 쪽(acp-updates-store의 STREAM_PUBLISH_MS)이 정한다. 닫히지 않은 code fence는 그릴 때만 닫아 code block으로 보인다.
// reasoning이 있으면 글 위에 reasoning 줄을 두고, 아직 글이 없으면 그 줄만 그린다.
import { memo } from "react";
import type { ArtifactsSlice } from "../../workspace/kinds/host.ts";
import type { AcpWriting } from "../../../../protocol/acp/mod.ts";
import { Said } from "./agent-turn.tsx";
import { ChatMarkdown } from "./chat-markdown.tsx";
import { Reasoning } from "./reasoning.tsx";
import { closeOpenFence, openFenceContent, splitLive } from "../live-text.ts";

// 끝난 block 묶음. 글이 같으면 다시 그리지 않는다.
const DoneChunk = memo(ChatMarkdown);

export const LiveMessage = memo(function LiveMessage({
  live,
  reasoning,
  artifacts,
}: {
  live: AcpWriting;
  reasoning: boolean;
  artifacts: ArtifactsSlice | undefined;
}) {
  const { done, tail } = splitLive(live.text);
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
            artifacts={artifacts}
          />
        )}
      </div>
    </Said>
  );
});
