// project icon. 사람이 올린 이미지만 있다(project는 선언한 icon이 없다). 표식 자리(런처 카드, workspace
// switcher)는 useProjectIcon으로 읽고, 올리는 자리는 ProjectIconField 하나다.
import { createContext, useContext } from "react";

import { projectApi } from "../../../../protocol/projects/project-api.ts";
import { commandBody } from "../../command-call.ts";
import type { CoreSource } from "../../desktop/connection/connection.ts";
import type { SourceResult } from "../../source-result.ts";
import {
  cachedIconReader,
  type IconFile,
  iconInputOf,
  type IconReader,
  type IconView,
  iconViewOf,
  useIconSrc,
} from "../icon-upload/icon-reader.ts";
import { IconUpload } from "../icon-upload/icon-upload.tsx";
import { WorkspaceMark } from "../workspace-mark/workspace-mark.tsx";
import { useEffect, useState } from "react";

export interface ProjectIconsDeps {
  /** 표식이 그릴 때 읽는 통로(짧게 캐시). */
  icon: IconReader;
  /** 올리는 자리가 읽는 지금 icon. 캐시 없이 새로 읽는다. */
  current(project: string): Promise<SourceResult<IconView>>;
  /** 올린 icon을 정한다. null이면 지운다. 성공하면 표식 통로의 캐시도 버린다. */
  set(project: string, icon: IconFile | null): Promise<SourceResult<true>>;
}

const ProjectIconsContext = createContext<ProjectIconsDeps | null>(null);

export const ProjectIconsProvider = ProjectIconsContext.Provider;

/** 없으면(테스트, overlay, 통로 없는 창) project는 첫 글자 표식이다. */
export function useProjectIcons(): ProjectIconsDeps | null {
  return useContext(ProjectIconsContext);
}

/** core `projects.icon`·`projects.set_icon`을 통로로 만든다. */
export function coreProjectIcons(
  core: CoreSource,
  now: () => number = Date.now,
): ProjectIconsDeps {
  const current = async (project: string): Promise<SourceResult<IconView>> => {
    const reply = await core.call({
      kind: "read",
      resource: "projects",
      method: "icon",
      body: { project },
    });
    return reply.ok
      ? {
          ok: true,
          value: iconViewOf(reply.value as Parameters<typeof iconViewOf>[0]),
        }
      : { ok: false, code: reply.error?.code ?? "internal" };
  };
  const icon = cachedIconReader(async (project) => {
    const view = await current(project);
    return view.ok ? (view.value.src ?? undefined) : undefined;
  }, now);
  return {
    icon,
    current,
    async set(project, file) {
      const reply = await core.call({
        kind: "command",
        resource: projectApi.setIcon.resource,
        method: projectApi.setIcon.method,
        body: commandBody(projectApi.setIcon, {
          input: { project, icon: iconInputOf(file) as never },
          compare: {},
          key: crypto.randomUUID(),
        }),
      });
      if (!reply.ok)
        return { ok: false, code: reply.error?.code ?? "internal" };
      icon.forget?.(project);
      return { ok: true, value: true };
    },
  };
}

/** project의 icon data URL. 올린 것이 없거나 통로가 없으면 undefined다. */
export function useProjectIcon(project: string | undefined) {
  return useIconSrc(useProjectIcons()?.icon, project);
}

/** project 표식. 올린 icon이 있으면 그 이미지, 없으면 첫 글자와 색이다. */
export function ProjectWorkspaceMark({
  id,
  name,
  icon,
}: {
  id: string;
  name: string;
  /** 부르는 쪽이 이미 가진 이미지. 있으면 그것을 쓴다. */
  icon?: string;
}) {
  const uploaded = useProjectIcon(icon === undefined ? id : undefined);
  const src = icon ?? uploaded;
  return (
    <WorkspaceMark
      kind="project"
      id={id}
      name={name}
      {...(src === undefined ? {} : { icon: src })}
    />
  );
}

/**
 * project icon 올리기 칸. 지금 표식과 [Upload image], 올린 것이 있으면 [Remove]다. 혼자 core를 읽고 쓰므로
 * project 설정 화면 맨 위에 그대로 놓는다. name은 icon이 없을 때 표식의 첫 글자다.
 */
export function ProjectIconField({
  project,
  name,
}: {
  project: string;
  name: string;
}) {
  const icons = useProjectIcons();
  const [view, setView] = useState<IconView | null>(null);

  useEffect(() => {
    let live = true;
    void icons?.current(project).then((read) => {
      if (live && read.ok) setView(read.value);
    });
    return () => {
      live = false;
    };
  }, [icons, project]);

  if (icons === null) return null;

  const change = async (file: IconFile | null) => {
    const done = await icons.set(project, file);
    if (!done.ok) return false;
    const read = await icons.current(project);
    if (!read.ok) return false;
    setView(read.value);
    return true;
  };

  return (
    <IconUpload
      preview={
        <WorkspaceMark
          kind="project"
          id={project}
          name={name}
          {...(view?.src ? { icon: view.src } : {})}
        />
      }
      onUpload={(bytes, type) => change({ type, bytes })}
      {...(view?.uploaded ? { onRemove: () => change(null) } : {})}
    />
  );
}
