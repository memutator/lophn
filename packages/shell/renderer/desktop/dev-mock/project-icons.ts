import {
  cachedIconReader,
  type IconView,
} from "../../parts/icon-upload/icon-reader.ts";
import type { ProjectIconsDeps } from "../../parts/project-icon/project-icon.tsx";

/** 올린 project icon을 메모리에 쥔다. 처음에는 모든 project가 첫 글자 표식이다. */
export function mockProjectIcons(): ProjectIconsDeps {
  const uploaded = new Map<string, string>();
  const view = (project: string): IconView => ({
    src: uploaded.get(project) ?? null,
    uploaded: uploaded.has(project),
  });
  const icon = cachedIconReader((project) =>
    Promise.resolve(uploaded.get(project)),
  );
  return {
    icon,
    current: (project) => Promise.resolve({ ok: true, value: view(project) }),
    set(project, file) {
      if (file === null) uploaded.delete(project);
      else {
        uploaded.set(
          project,
          `data:${file.type};base64,${btoa(String.fromCharCode(...file.bytes))}`,
        );
      }
      icon.forget?.(project);
      return Promise.resolve({ ok: true, value: true });
    },
  };
}
