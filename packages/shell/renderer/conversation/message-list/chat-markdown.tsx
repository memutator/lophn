// agent가 쓴 글 하나를 chat 모양 markdown으로 그린다. artifact path는 button link, link는 shell 창 밖으로,
// image는 불러오지 않고 alt 글의 link로 둔다(agent 답의 image 주소로 대화가 새지 않게 한다).
import type { ReactElement, ReactNode } from "react";
import { IconButton } from "@lophn/ui/primitives";
import { Markdown } from "@lophn/ui/reading";
import { t } from "@lophn/i18n";

import { workspaceIcons } from "../../icons/mod.ts";
import { MermaidBlock } from "./mermaid-block.tsx";
import { runnable, useRunCode } from "./run-code.ts";

import { artifactMentions } from "../../../../protocol/projects/artifact.ts";
import { windowLinkOpener } from "../../desktop/settings/core-call.ts";
import type { ArtifactsSlice } from "../../workspace/kinds/host.ts";
import {
  ArtifactLink,
  artifactPieces,
  useArtifactReload,
} from "./artifact-text.tsx";

export interface ChatMarkdownProps {
  /** agent가 쓴 markdown 원문. 사람 글은 넘기지 않는다(사람 글은 `ArtifactText`). */
  readonly text: string;
  /** 이 창 workspace(project나 앱)의 artifact 목록. 있으면 글과 inline code 속 path를 link로 그리고 모르는 path를 보면 목록을 다시 읽는다. 없으면 path는 글 그대로다. */
  readonly artifacts?: ArtifactsSlice | undefined;
  /**
   * 아직 자라는 중인 code fence의 내용(openFenceContent). 이 글과 같은 code block은 아직 닫히지
   * 않았으므로 mermaid diagram을 그리지 않고 code로 둔다.
   */
  readonly openFence?: string | null | undefined;
}

/** markdown 글 전체(원문)에서 모르는 artifact path를 찾아 목록을 다시 읽는다. code 안 path도 본다. */
export function ChatMarkdown({
  text,
  artifacts,
  openFence,
}: ChatMarkdownProps): ReactElement {
  useArtifactReload(text, artifacts);
  const open = windowLinkOpener();
  const run = useRunCode();
  const renderText =
    artifacts === undefined
      ? undefined
      : (piece: string, kind: "text" | "code"): ReactNode => {
          if (kind === "text") return artifactPieces(piece, artifacts);
          // agent는 path를 backtick에 넣는 일이 많다. inline code 전체가 path이면 그것도 link로 둔다.
          if (artifacts.workspace === null) return undefined;
          const mentions = artifactMentions(
            piece,
            artifacts.workspace,
            artifacts.items.map((item) => item.name),
          );
          const one = mentions[0];
          return mentions.length === 1 &&
            one !== undefined &&
            one.start === 0 &&
            one.end === piece.length ? (
            <ArtifactLink artifacts={artifacts} name={one.name} label={piece} />
          ) : undefined;
        };
  return (
    <Markdown
      source={text}
      variant="chat"
      images="link"
      onOpenLink={open === undefined ? undefined : (href) => void open(href)}
      renderText={renderText}
      renderCode={(code, language) =>
        language?.toLowerCase() === "mermaid" && code !== openFence ? (
          <MermaidBlock code={code} />
        ) : undefined
      }
      codeAction={
        run === null
          ? undefined
          : (code, language) =>
              runnable(code, language) ? (
                <IconButton
                  icon={workspaceIcons.terminal}
                  size="sm"
                  label={t("conversation.button.run-in-terminal")}
                  onClick={() => run(code)}
                />
              ) : undefined
      }
    />
  );
}
