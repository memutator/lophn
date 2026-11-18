// desktop host가 Agent 화면에 주는 조각(`DesktopParts`). desktop host만 import한다.
import {
  enterSecret,
  providerSecretName,
  windowLinkOpener,
  windowSecretInputOpener,
} from "../desktop/settings/core-call.ts";
import { VisualBlock } from "../workspace/visuals/block-frame.tsx";
import type { DesktopParts } from "./desktop-parts.ts";
import { MermaidBlock } from "./message-list/mermaid-block.tsx";

export const desktopParts: DesktopParts = {
  Diagram: MermaidBlock,
  AppCard: ({ message, index, part }) => (
    <VisualBlock
      message={message}
      block={`card-${index}`}
      card={{
        app: part.app,
        release: null,
        view: part.view,
        ...(part.params === undefined ? {} : { params: part.params }),
      }}
      title={part.view}
    />
  ),
  linkOpener: windowLinkOpener,
  enterProviderKey: (provider, machine) =>
    void enterSecret(windowSecretInputOpener(machine), {
      name: providerSecretName(provider.id),
      purpose: "provider",
      subject: provider.name,
    }),
};
