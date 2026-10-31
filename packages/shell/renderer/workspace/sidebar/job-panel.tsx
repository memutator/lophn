// Jobs panel. project sidebar는 이 project에 걸린 job만, Home은 모든 job을 줄로 보인다. 줄과 머리 줄의 단추는
// Jobs 탭을 연다(그 job을 펼치지는 않는다). 줄은 overlay와 같은 `JobRows`다.
import { IconButton } from "@lophn/ui/primitives";
import { Tooltip } from "@lophn/ui/overlay";
import { t } from "@lophn/i18n";

import { JobRows } from "../../desktop/jobs/job-rows.tsx";
import type { JobsSource } from "../../desktop/jobs/source.ts";
import { PanelActions } from "../../shell/right-sidebar.tsx";
import { actionIcons } from "../../icons/mod.ts";

export function JobPanel({
  project,
  source,
  onOpenJobs,
}: {
  /** null이면 모든 job(Home). */
  project: string | null;
  source: JobsSource;
  /** Jobs 탭을 연다. */
  onOpenJobs: () => void;
}) {
  return (
    <>
      <PanelActions>
        <Tooltip content={t("jobs.button.open-all")}>
          <IconButton
            size="sm"
            icon={actionIcons.open}
            label={t("jobs.button.open-all")}
            onClick={onOpenJobs}
          />
        </Tooltip>
      </PanelActions>
      <JobRows project={project} source={source} onOpen={onOpenJobs} />
    </>
  );
}
