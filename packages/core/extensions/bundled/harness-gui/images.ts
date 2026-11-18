// 지난 대화의 그림. 사람이 붙인 그림은 CLI의 session file에 base64로만 남는다(live에서는 탭 임시 폴더 file의 `file://` link다).
// 지난 대화를 다시 그릴 때 그 bytes를 탭의 임시 폴더에 다시 써서 live와 같은 link로 싣는다. 화면은 그 link를 그림으로 그린다.
import type { ContentBlock } from "../../../../protocol/lophn-agent/content-block.ts";
import type { AcpTerminal } from "../../../../protocol/extensions/mod.ts";

/** 쓴 그림마다 link 하나. 쓰지 못한 것(탭이 없음, base64가 없음, 그림이 아님)은 빠지고, 부른 쪽이 그 자리에 `[image]`를 둔다. */
export async function replayImages(
  terminal: AcpTerminal | null,
  images: readonly {
    data?: string | undefined;
    mimeType?: string | undefined;
  }[],
): Promise<ContentBlock[]> {
  const links: ContentBlock[] = [];
  for (const image of images) {
    if (terminal === null || !image.data) continue;
    const path = await terminal.writeImage({
      name: "image",
      data: new Uint8Array(Buffer.from(image.data, "base64")),
    });
    if (path === null) continue;
    links.push({
      type: "resource_link",
      uri: `file://${path}`,
      name: path.slice(path.lastIndexOf("/") + 1),
      ...(image.mimeType === undefined ? {} : { mimeType: image.mimeType }),
    });
  }
  return links;
}
