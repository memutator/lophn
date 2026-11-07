// 쓰는 중인 agent 글. 저장되기 전의 model 호출 하나를 chat markdown으로 그리고, 같은 호출의 글이 자라는
// 동안은 LIVE_RENDER_MS마다만 다시 parse한다. 닫히지 않은 code fence는 그릴 때만 닫아 code block으로 보인다.
// reasoning이 있으면 글 위에 reasoning 줄을 두고, 아직 글이 없으면 그 줄만 그린다.
import { memo, useEffect, useRef, useState } from "react";
import type { ArtifactsSlice } from "../../workspace/kinds/host.ts";
import type { AcpWriting } from "../../../../protocol/acp/mod.ts";
import { Said } from "./agent-turn.tsx";
import { ChatMarkdown } from "./chat-markdown.tsx";
import { Reasoning } from "./reasoning.tsx";
import { closeOpenFence, openFenceContent } from "../live-text.ts";

/** 긴 글을 delta마다 markdown으로 다시 parse하지 않는다. */
export const LIVE_RENDER_MS = 40;

export const LiveMessage = memo(function LiveMessage({
  live,
  reasoning,
  artifacts,
}: {
  live: AcpWriting;
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
            openFence={openFenceContent(live.text)}
            artifacts={artifacts}
          />
        )}
      </div>
    </Said>
  );
});

type FrameHandle = { raf: number } | { timer: ReturnType<typeof setTimeout> };

function requestFrame(callback: () => void): FrameHandle {
  if (typeof requestAnimationFrame === "function") {
    return { raf: requestAnimationFrame(callback) };
  }
  return { timer: setTimeout(callback, 16) };
}

function cancelFrame(handle: FrameHandle): void {
  if ("raf" in handle) cancelAnimationFrame(handle.raf);
  else clearTimeout(handle.timer);
}

/**
 * 화면에 보일 live 글. null이 되거나 model 호출이 바뀌면 기다리지 않고 바꾸고(저장된 message와 겹쳐
 * 보이지 않게 그리는 동안 바로 바꾼다), 같은 호출의 글이 자라는 동안은 frame 하나를 예약해 두고 그
 * frame에서 마지막으로 바꾼 지 LIVE_RENDER_MS가 지났으면 그때의 최신 값으로 바꾼다. 새 값이 와도 예약한
 * frame을 취소하지 않는다. 취소하면 render가 느린 긴 thread에서 값이 interval보다 자주 올 때마다 예약이
 * 지워져 첫 값과 마지막 값만 보인다.
 */
export function useThrottledLive(
  live: AcpWriting | null,
  now: () => number,
): AcpWriting | null {
  const [shown, setShown] = useState<AcpWriting | null>(live);
  const latest = useRef(live);
  const shownRef = useRef(live);
  const nowRef = useRef(now);
  const frame = useRef<FrameHandle | undefined>(undefined);
  const committedAt = useRef(0);
  nowRef.current = now;

  const fresh =
    live === null || shown === null || live.model_call !== shown.model_call;

  useEffect(
    () => () => {
      if (frame.current !== undefined) cancelFrame(frame.current);
    },
    [],
  );

  useEffect(() => {
    latest.current = live;
    const current = shownRef.current;
    const commit = (value: AcpWriting | null) => {
      shownRef.current = value;
      committedAt.current = nowRef.current();
      setShown(value);
    };

    if (
      live === null ||
      current === null ||
      live.model_call !== current.model_call
    ) {
      if (frame.current !== undefined) cancelFrame(frame.current);
      frame.current = undefined;
      if (live !== current) commit(live);
      return;
    }
    if (live === current || frame.current !== undefined) return;

    const tick = () => {
      if (nowRef.current() - committedAt.current < LIVE_RENDER_MS) {
        frame.current = requestFrame(tick);
        return;
      }
      frame.current = undefined;
      if (latest.current !== shownRef.current) commit(latest.current);
    };
    frame.current = requestFrame(tick);
  }, [live]);

  return fresh ? live : shown;
}
