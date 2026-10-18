import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { Dialog } from "@lophn/ui/overlay";
import { t } from "@lophn/wording";

import { ManageModelsContext } from "../../../conversation/model-picker/manage-context.ts";
import { DefaultModelField } from "../../../workspace/agents/editor/model-field.tsx";
import type { ModelsView } from "../../../workspace/agents/source.ts";
import type {
  AgentsSettingsSource,
  ModelChoice,
} from "../agents/settings-source.ts";

interface DefaultModelDialogProps {
  agents: AgentsSettingsSource;
  /** custom provider의 목록을 읽은 결과 한 줄. */
  notice?: string;
  onClose: () => void;
}

/** provider를 처음 붙인 뒤 전역 기본 model을 고르게 하는 대화창. 고르면 저장하고 닫는다. [Skip]은 저장 없이 닫는다. */
export function DefaultModelDialog(
  { agents, notice, onClose }: DefaultModelDialogProps,
): ReactNode {
  const [models, setModels] = useState<ModelsView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void agents.editor.models().then((read) => {
      if (live) setModels(read.ok ? read.value : null);
    });
    return () => {
      live = false;
    };
  }, [agents]);

  async function choose(choice: ModelChoice): Promise<void> {
    setFailed(false);
    const saved = await agents.changeDefaultModel(choice);
    if (saved.ok) onClose();
    else setFailed(true);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("settings.title.choose-default-model")}
      actions={<Button onClick={onClose}>{t("settings.button.skip")}</Button>}
    >
      {/* 이 대화창 안의 picker가 창을 또 쌓지 않게 Manage models 줄을 숨긴다. */}
      <ManageModelsContext.Provider value={null}>
        {notice === undefined ? null : <p role="status">{notice}</p>}
        <p>{t("settings.notice.choose-default-model")}</p>
        <DefaultModelField
          models={models}
          source={agents.editor}
          value={null}
          onChange={(choice) => void choose(choice)}
        />
        {failed
          ? <p role="status">{t("settings.agents.action-failed")}</p>
          : null}
      </ManageModelsContext.Provider>
    </Dialog>
  );
}
