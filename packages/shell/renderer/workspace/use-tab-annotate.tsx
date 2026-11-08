// 앱 화면 탭과 preview 탭이 같이 쓰는 Annotate 길. 머리 줄(꺼진 동안은 ⋯ 메뉴의 Annotate, 켜진 동안은 Annotate 줄)과
// 보냄·실패 알림 toast를 만든다. 받는 쪽은 이 앱 workspace에서 열린 lophn session이고, 없으면 lophn의 새 session이다.
import { type ReactNode, useEffect, useRef } from "react";
import { MenuIcon } from "@lophn/ui/overlay";
import { t } from "@lophn/i18n";

import { annotateHead } from "../app-frame/annotate/annotate-head.tsx";
import { useAnnotate } from "../app-frame/annotate/use-annotate.ts";
import { useViewToast } from "../app-frame/annotate/use-view-toast.ts";
import type { ShellHead } from "../app-frame/app-tab-head.tsx";
import { useAnnotateApi } from "../artifact/artifact-api.tsx";
import { useBrowserOverlay } from "../browser/browser-api.tsx";
import { editorIcons } from "../icons/mod.ts";
import type { AgentViewSlice } from "./kinds/host.ts";

// ⋯ 메뉴 항목 id. 앱 항목(`app-head:`)과 탭 기본 항목과 겹치지 않는다.
const ANNOTATE_ITEM = "shell:annotate";

export function useTabAnnotate(input: {
  /** 앱 view의 view_session. 아직 열리지 않았으면 null이다. */
  viewSession: string | null;
  /** 무엇에 다는지(앱 이름). */
  target: string;
  agentView: AgentViewSlice | null;
  /** Annotate가 꺼진 동안 머리 줄에 더하는 단추. key는 이 단추가 바뀔 때 바뀐다. */
  off?: { readonly key: string; readonly actions: ReactNode };
}): {
  shellHead: ShellHead | undefined;
  toast: ReturnType<typeof useViewToast>;
} {
  const { viewSession, target, agentView, off } = input;
  const annotateApi = useAnnotateApi();
  const annotating = useAnnotate(annotateApi, viewSession);
  const toast = useViewToast(useBrowserOverlay() ?? undefined);
  const annotateOn = annotating.state?.on ?? false;
  const failure = annotating.failure;
  useEffect(() => {
    if (failure === null) return;
    toast.show({
      title:
        failure === "archived"
          ? t("app-space.error.annotations-archived")
          : t("app-space.error.annotations-failed"),
    });
  }, [failure]);

  async function sendAnnotations(): Promise<void> {
    const session = agentView?.workspaceLophnSession() ?? null;
    const sent = await annotating.send({ session });
    if (sent === null) return;
    const agent = agentView?.nameOf(sent.session) ?? "lophn";
    toast.show({
      title: t("app-space.title.annotations-sent-to", {
        count: sent.sent,
        agent,
      }),
      body: t("app-space.text.annotations-sent"),
    });
    agentView?.openSession(sent.session);
  }
  const count = annotating.state?.items.length ?? 0;
  const sending = annotating.state?.phase === "sending";
  // 머리 줄에 올린 단추의 callback은 다시 올리지 않아도 최신 값을 읽는다.
  const latest = useRef({ annotating, sendAnnotations });
  latest.current = { annotating, sendAnnotations };

  let shellHead: ShellHead | undefined;
  if (annotateApi === undefined || viewSession === null) shellHead = undefined;
  else if (annotateOn) {
    shellHead = {
      key: `on:${count}:${sending}:${target}`,
      ...annotateHead({
        target,
        count,
        sending,
        sendLabel: t("app-space.button.send-annotations-to", {
          agent: "lophn",
        }),
        note: t("app-space.text.annotations-note-to", { agent: "lophn" }),
        guide: t("app-space.text.annotate-on"),
        onClear: () => latest.current.annotating.remove("all"),
        onDone: () => latest.current.annotating.setMode(false),
        onSend: () => void latest.current.sendAnnotations(),
      }),
    };
  } else {
    shellHead = {
      key: off?.key ?? "off",
      ...(off === undefined ? {} : { actions: off.actions }),
      menu: {
        items: [
          {
            id: ANNOTATE_ITEM,
            label: t("app-space.button.annotate"),
            leading: <MenuIcon icon={editorIcons.edit} />,
          },
        ],
        onSelect: () => latest.current.annotating.setMode(true),
      },
    };
  }
  return { shellHead, toast };
}
