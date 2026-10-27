// 쓰는 중인 agent 글. 저장되기 전의 model 호출 하나를 chat markdown으로 그리고, 같은 호출의 글이 자라는
// 동안은 100ms마다만 다시 parse한다. 닫히지 않은 code fence는 그릴 때만 닫아 code block으로 보인다.
// reasoning이 있으면 글 위에 reasoning 줄을 두고, 아직 글이 없으면 그 줄만 그린다.
import { memo, useEffect, useRef, useState } from "react";
import type { ArtifactsSlice } from "../../workspace/kinds/host.ts";
import { Said } from "./agent-turn.tsx";
import { ChatMarkdown } from "./chat-markdown.tsx";
import { Reasoning } from "./reasoning.tsx";
import { closeOpenFence, type LiveText } from "../live-text.ts";

/** 긴 글을 delta마다 markdown으로 다시 parse하지 않는다. */
export const LIVE_RENDER_MS = 100;

export const LiveMessage = memo(function LiveMessage({
  live,
  reasoning,
  artifacts,
}: {
  live: LiveText;
  reasoning: boolean;
  artifacts: ArtifactsSlice | undefined;
}) {
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
        {live.text === "" ? null : (
          <ChatMarkdown
            text={closeOpenFence(live.text)}
            artifacts={artifacts}
          />
        )}
      </div>
    </Said>
  );
});

/**
 * 화면에 보일 live 글. null이 되거나 model 호출이 바뀌면 기다리지 않고 바꾸고(저장된 message와 겹쳐
 * 보이지 않게 그리는 동안 바로 바꾼다), 같은 호출의 글이 자라는 동안은 앞서 바꾼 때부터 100ms가 지나야
 * 바꾼다. 마지막 값은 늦어도 100ms 뒤에 보인다.
 */
export function useThrottledLive(
  live: LiveText | null,
  now: () => number,
): LiveText | null {
  const [shown, setShown] = useState<LiveText | null>(live);
  const changedAt = useRef(0);
  const fresh =
    live === null || shown === null || live.modelCall !== shown.modelCall;

  useEffect(() => {
    if (live === shown) return;
    if (fresh) {
      changedAt.current = now();
      setShown(live);
      return;
    }
    const wait = Math.max(0, LIVE_RENDER_MS - (now() - changedAt.current));
    const timer = setTimeout(() => {
      changedAt.current = now();
      setShown(live);
    }, wait);
    return () => clearTimeout(timer);
  }, [fresh, live, shown, now]);

  return fresh ? live : shown;
}
