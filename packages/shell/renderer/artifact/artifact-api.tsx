// artifact 탭이 쓰는 창 통로. window.lophnArtifact(shell preload)와 annotate 통로를 provider로 둔다.
// desktop 창 preload에만 있어서 없으면 null(artifact)·undefined(annotate)다.
import { createContext, useContext } from "react";

import type { LophnShellAnnotateApi } from "../../ipc/annotation.ts";
import type { LophnArtifactApi } from "../../ipc/artifact.ts";

const ArtifactApiContext = createContext<LophnArtifactApi | null>(null);
const AnnotateApiContext = createContext<LophnShellAnnotateApi | undefined>(
  undefined,
);

export const ArtifactApiProvider = ArtifactApiContext.Provider;
export const AnnotateApiProvider = AnnotateApiContext.Provider;

export function useArtifactApi(): LophnArtifactApi | null {
  return useContext(ArtifactApiContext);
}

export function useAnnotateApi(): LophnShellAnnotateApi | undefined {
  return useContext(AnnotateApiContext);
}
