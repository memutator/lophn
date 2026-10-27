// artifact view의 navigation 규칙. Electron 없는 순수 함수다. subresource 요청은 막지 않는다
// (CSP와 죽은 proxy가 막는다). main frame은 자기 host의 file로만 간다.
import { ARTIFACT_SCHEME } from "./session.ts";

export type ArtifactNavigation =
  | { allow: true }
  | {
      allow: false;
      /** 사용자가 누른 http/https link다. 입력이 fresh일 때만 renderer로 알린다. */
      external?: true;
    };

export function decideArtifactNavigation(input: {
  url: string;
  isMainFrame: boolean;
  host: string;
}): ArtifactNavigation {
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return { allow: false };
  }
  if (url.protocol === `${ARTIFACT_SCHEME}:` && url.hostname === input.host) {
    return { allow: true };
  }
  if (
    input.isMainFrame &&
    (url.protocol === "http:" || url.protocol === "https:")
  ) {
    return { allow: false, external: true };
  }
  return { allow: false };
}
