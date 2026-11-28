import { ok } from "../../../base/mod.ts";
import type { AppToolkit } from "./app-toolkit.ts";

// 다른 앱의 비공개 command를 뺀다. agent는 자기가 놓인 앱 workspace의 command를 다 보고, 그 밖(다른 앱, project, home의 lophn)은
// `public` command만 본다. 다른 기계의 앱은 그 앱 id가 이 앱 workspace와 같아도 `public`만이다(받는 기계도 비공개를 거절한다).
// `lophn <slug> <command>`가 부를 때마다 거른다.
export function withPublicOnly(toolkit: AppToolkit): AppToolkit {
  const load: AppToolkit["load"] = async (who, memo, slug) => {
    const loaded = await toolkit.load(who, memo, slug);
    if (!loaded.ok) return loaded;
    const views = loaded.value.views.map((view) => {
      const own =
        view.machine === undefined &&
        who.workspace?.kind === "app" &&
        who.workspace.id === view.app;
      return {
        ...view,
        tools: view.tools.filter((tool) => own || tool.public),
      };
    });
    return ok({ ...loaded.value, views });
  };

  return { load };
}
