import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type AgentPlace,
  skillsRead,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  Input,
  Output,
  ReadDefinition,
  ReadSnapshot,
  RequestContext,
} from "../../../protocol/server/mod.ts";
import { dataRootOf, type PlaceFiles, type ReadSql } from "./place-store.ts";
import {
  parseProjectExtensions,
  type ProjectLayer,
} from "./project-settings.ts";
import {
  discoverSkills,
  type DomainStore,
  type SkillFiles,
  type SkillSources,
} from "./skills.ts";

// `ReadSkills` handler다. 내장, 전역, (project나 app을 주면) 그 그릇의 domain 층을 합친 skill 목록과
// 끈 이름을 사람 화면과 machine에 준다. 같은 이름은 내장·전역 안에서 마지막 층이 덮고 가려진 쪽은 목록에 두지 않는다. domain 층 skill은
// domain마다 한 줄이다(받는 쪽이 `pickSkills`로 이름마다 하나를 고른다). 끈 skill도
// 목록에 남고 enabled만 false다. 끈 이름은 지금 발견되지 않는 것까지 그대로 돌려준다. 내장 skill은 role을 가리지
// 않고 모두 낸다(어느 role의 것인지는 선언이 말한다).

// 다른 concern의 값을 읽는 길이다. 정본은 각 concern이고 여기서는 읽기만 한다.
type SkillsReadLookups = {
  // 전역 층의 skill 출처다: 등록 폴더, 개인 보관소, 내장 폴더.
  skillSources(): Omit<SkillSources, "domains">;
  // 전역에서 끈 skill의 정확한 이름이다.
  skillsOff(): readonly string[];
  placeExists(place: AgentPlace): boolean;
  // 그 그릇의 active domain이다(이름순).
  placeDomains(place: AgentPlace): readonly { id: string; name: string }[];
};

type SkillsReadDeps = {
  projectLayer: ProjectLayer;
  files: PlaceFiles;
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
        let domains: DomainStore[] = [];
        const place: AgentPlace | null =
          input.project !== undefined
            ? { kind: "project", id: input.project }
            : input.app !== undefined
              ? { kind: "app", id: input.app }
              : null;
        if (place !== null) {
          if (!lookups.placeExists(place)) {
            return err({
              code: "not_found",
              message: `${place.kind} not found`,
            });
          }
          const root = dataRootOf(snapshot.sql, deps.dataRoot);
          if (!root.ok) return root;
          domains = lookups.placeDomains(place).map((domain) => ({
            domain: domain.id,
            folder: deps.projectLayer.domains.skillsFolder(
              root.value,
              domain.id,
            ),
          }));
          // 앱 그릇에는 project 층 설정이 없다. 파일이 없거나 틀렸으면 이 project에서 끈 것이 없다.
          // 틀린 파일은 설정을 읽는 쪽이 알린다.
          if (input.project !== undefined) {
            try {
              const text = deps.files.read(
                deps.projectLayer.extensionsFile(root.value, input.project),
              );
              const parsed =
                text === null ? null : parseProjectExtensions(text);
              if (parsed !== null && parsed.ok) {
                off = [...new Set([...off, ...parsed.value.skills_off])];
              }
            } catch {
              return err({
                code: "unavailable",
                message: "project extensions file could not be read",
              });
            }
          }
        }
        let listing: ReturnType<typeof discoverSkills>;
        try {
          listing = discoverSkills(
            deps.skillFiles,
            { ...lookups.skillSources(), domains },
            { role: null, off },
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
            domain: entry.domain,
          })),
          skills_off: off,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
  };
}
