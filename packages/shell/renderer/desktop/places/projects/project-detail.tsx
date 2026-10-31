import { useState } from "react";
import { Dialog } from "@lophn/ui/overlay";

import { ProjectIconField } from "../../../parts/project-icon/project-icon.tsx";
import { ProjectForm } from "./project-form.tsx";
import type { ProjectItem, ProjectsSource } from "./source.ts";

interface ProjectDetailDialogProps {
  source: ProjectsSource;
  project: ProjectItem;
  /** 등록을 바꿨다. 목록의 카드를 새 값으로 바꾼다. */
  onChanged: (project: ProjectItem) => void;
  onLatest: () => void;
  onRelocate: (project: ProjectItem, folder: string) => Promise<boolean>;
  onClose: () => void;
}

// 카드의 [Details]가 여는 dialog. 열려 있는 동안만 그려서 열 때마다 처음 초안에서 시작한다.
export function ProjectDetailDialog({
  source,
  project,
  onChanged,
  onLatest,
  onRelocate,
  onClose,
}: ProjectDetailDialogProps) {
  const [saved, setSaved] = useState(false);
  return (
    <Dialog
      open
      width="wide"
      title={project.title}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ProjectForm
        key={`${project.id}:${project.revision}`}
        source={source}
        project={project}
        saved={saved}
        onChanged={(next) => {
          setSaved(true);
          onChanged(next);
        }}
        onLatest={onLatest}
        onRelocate={onRelocate}
        iconField={
          <ProjectIconField project={project.id} name={project.title} />
        }
      />
    </Dialog>
  );
}
