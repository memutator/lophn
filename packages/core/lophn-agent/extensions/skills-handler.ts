import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type AgentWorkspace,
  skillsRead,
  workspaceOfKey,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  Input,
  Output,
  ReadDefinition,
  ReadSnapshot,
  RequestContext,
} from "../../../protocol/server/mod.ts";
import {
  dataRootOf,
  type WorkspaceFiles,
  type ReadSql,
} from "./workspace-store.ts";
import {
  parseProjectExtensions,
  workspaceSkillsOf,
  type ProjectLayer,
} from "./project-settings.ts";
import {
  discoverSkills,
  type WorkspaceSkills,
  type SkillFiles,
  type SkillSources,
} from "./skills.ts";

// `ReadSkills` handler다. 내장, 전역, (workspace를 주면) 그 workspace(Home, project, 앱) 폴더와 그릇 자리의 층을 합친 skill 목록과
// 끈 이름을 사람 화면과 machine에 준다. 같은 이름은 마지막 층이 덮고 가려진 쪽은 목록에 두지 않는다. 끈 skill도
// 목록에 남고 enabled만 false다. 끈 이름은 지금 발견되지 않는 것까지 그대로 돌려준다. 내장 skill은 workspace 종류를 가리지
// 않고 모두 낸다(어느 workspace 종류의 것인지는 선언이 말한다).

// 다른 concern의 값을 읽는 길이다. 정본은 각 concern이고 여기서는 읽기만 한다.
type SkillsReadLookups = {
  // 전역 층의 skill 출처다: 등록 폴더, 개인 보관소, 내장 폴더.
  skillSources(): Omit<SkillSources, "workspaceData" | "workspace">;
  // 전역에서 끈 skill의 정확한 이름이다.
  skillsOff(): readonly string[];
  workspaceExists(workspace: AgentWorkspace): boolean;
  // project의 첫 등록 폴더나 앱 source 폴더다. 없으면 null이다.
  sourceFolder(workspace: AgentWorkspace): string | null;
};

type SkillsReadDeps = {
  projectLayer: ProjectLayer;
  files: WorkspaceFiles;
  skillFiles: SkillFiles;
  lookups(sql: ReadSql): SkillsReadLookups;
  // 없으면 ledger 파일이 있는 폴더가 data root다.
  dataRoot?: string;
};

export function createSkillsRead(deps: SkillsReadDeps): {
  read: ReadDefinition<typeof skillsRead>;
} {
  return {
    read: {
      route: skillsRead,
      handle(
        snapshot: ReadSnapshot,
        _ctx: RequestContext,
        input: Input<typeof skillsRead>,
      ): Result<Output<typeof skillsRead>> {
        const lookups = deps.lookups(snapshot.sql);
        let off = [...lookups.skillsOff()];
        let workspaceData: string | null = null;
        let workspaceSkills: WorkspaceSkills | null = null;
        // 열쇠가 없으면 전역만이다. "home"은 workspace 없이 Home의 그릇 자리를 읽는다.
        const workspace = (
          input.workspace === undefined ? null : workspaceOfKey(input.workspace)
        ) as AgentWorkspace | null;
        if (input.workspace !== undefined) {
          if (workspace !== null && !lookups.workspaceExists(workspace)) {
            return err({
              code: "not_found",
              message: `${workspace.kind} not found`,
            });
          }
          const root = dataRootOf(snapshot.sql, deps.dataRoot);
          if (!root.ok) return root;
          workspaceSkills = workspaceSkillsOf(
            deps.projectLayer,
            workspace,
            workspace === null ? null : lookups.sourceFolder(workspace),
          );
          workspaceData = deps.projectLayer.workspaceDataSkillsFolder(
            root.value,
            workspace,
          );
          // 이 workspace에서 끈 이름이다. 파일이 없거나 틀렸으면 끈 것이 없다. 틀린 파일은 설정을 읽는 쪽이 알린다.
          try {
            const text = deps.files.read(
              deps.projectLayer.extensionsFile(root.value, workspace),
            );
            const parsed = text === null ? null : parseProjectExtensions(text);
            if (parsed !== null && parsed.ok) {
              off = [...new Set([...off, ...parsed.value.skills_off])];
            }
          } catch {
            return err({
              code: "unavailable",
              message: "extensions file could not be read",
            });
          }
        }
        let listing: ReturnType<typeof discoverSkills>;
        try {
          listing = discoverSkills(
            deps.skillFiles,
            {
              ...lookups.skillSources(),
              workspace: workspaceSkills,
              workspaceData,
            },
            { kind: null, off },
          );
        } catch {
          return err({
            code: "unavailable",
            message: "skills could not be listed",
          });
        }
        return ok({
          skills: listing.entries.map((entry) => ({
            name: entry.name,
            description: entry.description,
            source: entry.source,
            enabled: entry.enabled,
            can_disable: entry.can_disable,
          })),
          skills_off: off,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
  };
}
