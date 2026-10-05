// EditorSource를 main의 core 통로로 만든다. token·port는 main에 있고 이 쪽은 route 이름과
// 입력만 보낸다. 응답은 main의 contract client가 route output schema로 이미 검사했다.
// 아래 응답 모양은 그 schema(documents.get·read·list·resolve, outline.document,
// projects.get)에서 이 화면이 읽는 field만 옮긴 것이다. contracts를 import하면 zod와
// core 쪽 graph가 renderer bundle에 들어오므로 type도 들이지 않는다.
import type { CoreSource } from "../desktop/connection/connection.ts";
import type { CoreCall } from "../../ipc/core.ts";
import type { LinkTarget } from "./link-picker/link-picker.ts";
import {
  documentAddress,
  fileNameOf,
  type JoinedBody,
  joinPage,
} from "./model.ts";
import type {
  BodyState,
  DocumentInfo,
  EditorSource,
  OutlineSection,
  SourceResult,
} from "./source.ts";

interface DocumentGet {
  document: { id: string; title: string; name: string | null };
  version: {
    id: string;
    number: number;
    saved_at: string;
    files: { path: string; primary: boolean }[] | { hash: string };
  };
}

interface ReadResult {
  section_status: "whole" | "found" | "missing" | "unverified" | "unsupported";
  text: string | null;
  ranges: { start_line: number; end_line: number }[];
  complete: boolean;
  next_cursor: string | null;
}

interface OutlinePage {
  entries: {
    key: string;
    title: string;
    level: number;
    subtree_range: { start_line: number };
  }[];
  complete: boolean;
  next_cursor: string | null;
}

interface ProjectGet {
  project: { name: string };
}

interface DocumentList {
  documents: { document: { title: string; name: string | null } }[];
  next_cursor: string | null;
}

interface DocumentResolve {
  resolved: { document: string };
}

/** 본문을 끝까지 읽을 때 page 상한. 12,000 codepoint page로 약 6MB다. */
const BODY_PAGE_LIMIT = 500;
/** 링크 고르기에 모을 문서 page 상한. */
const LINK_PAGE_LIMIT = 20;

async function call<T>(
  core: CoreSource,
  kind: CoreCall["kind"],
  resource: string,
  method: string,
  body: unknown,
): Promise<SourceResult<T>> {
  const reply = await core.call({ kind, resource, method, body });
  if (!reply.ok) return { ok: false, code: reply.error?.code ?? "internal" };
  return { ok: true, value: reply.value as T };
}

function documentInfo(value: DocumentGet): DocumentInfo {
  const files = Array.isArray(value.version.files) ? value.version.files : [];
  const primary = files.find((file) => file.primary)?.path ?? null;
  const document = value.document;
  return {
    id: document.id,
    title: document.title,
    fileName: primary === null
      ? (document.name ?? document.title)
      : fileNameOf(primary),
    path: primary,
    version: value.version.id,
    versionNumber: value.version.number,
    savedAt: Date.parse(value.version.saved_at),
  };
}

/** 글이 없는 page의 이유. documents가 준 상태만 옮긴다. */
function withoutText(page: ReadResult): BodyState | null {
  if (page.section_status === "unverified") return { kind: "unreadable" };
  if (page.section_status === "unsupported") return { kind: "unsupported" };
  if (page.section_status === "missing") return { kind: "unreadable" };
  if (page.text === null) return { kind: "hidden" };
  return null;
}

function parseAddress(href: string) {
  const match = /^([^/#@]+)\/([^/#@]+)(?:#([^#@]+))?(?:@([1-9][0-9]*))?$/.exec(
    href,
  );
  if (!match) return null;
  let section: string | null = null;
  try {
    section = match[3] === undefined ? null : decodeURIComponent(match[3]);
  } catch {
    return null;
  }
  return {
    place: match[1]!,
    document: match[2]!,
    section,
    version: match[4] === undefined ? null : Number(match[4]),
  };
}

export function coreEditorSource(core: CoreSource): EditorSource {
  return {
    async document(id) {
      const result = await call<DocumentGet>(
        core,
        "read",
        "documents",
        "get",
        { document: id },
      );
      return result.ok
        ? { ok: true, value: documentInfo(result.value) }
        : result;
    },

    async body(document, version, onPage) {
      let joined: JoinedBody | null = null;
      let cursor: string | undefined;
      for (let page = 0; page < BODY_PAGE_LIMIT; page += 1) {
        const result: SourceResult<ReadResult> = await call<ReadResult>(
          core,
          "worker",
          "documents",
          "read",
          {
            reference: { document, version, section: null },
            ...(cursor === undefined ? {} : { cursor }),
          },
        );
        if (!result.ok) return { kind: "failed" };
        const missing = withoutText(result.value);
        if (missing) return missing;
        joined = joinPage(joined, {
          text: result.value.text ?? "",
          ranges: result.value.ranges,
        });
        const complete = result.value.complete;
        const state: BodyState = { kind: "text", text: joined.text, complete };
        onPage(state);
        if (complete || result.value.next_cursor === null) {
          return { kind: "text", text: joined.text, complete: true };
        }
        cursor = result.value.next_cursor;
      }
      // 상한까지 읽고도 끝나지 않으면 편집할 수 있는 온전한 글이 아니다.
      return { kind: "text", text: joined?.text ?? "", complete: false };
    },

    async outline(document, version) {
      const sections: OutlineSection[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < BODY_PAGE_LIMIT; page += 1) {
        const result: SourceResult<OutlinePage> = await call<OutlinePage>(
          core,
          "worker",
          "outline",
          "document",
          {
            reference: { document, version, section: null },
            depth: 6,
            ...(cursor === undefined ? {} : { cursor }),
          },
        );
        if (!result.ok) return result;
        for (const entry of result.value.entries) {
          if (entry.level < 1) continue;
          sections.push({
            key: entry.key,
            title: entry.title,
            level: entry.level,
            line: entry.subtree_range.start_line,
          });
        }
        if (result.value.complete || result.value.next_cursor === null) break;
        cursor = result.value.next_cursor;
      }
      return { ok: true, value: sections };
    },

    async linkTargets(project) {
      const projectResult = await call<ProjectGet>(
        core,
        "read",
        "projects",
        "get",
        { project },
      );
      if (!projectResult.ok) return projectResult;
      const place = projectResult.value.project.name;
      const targets: LinkTarget[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < LINK_PAGE_LIMIT; page += 1) {
        const result: SourceResult<DocumentList> = await call<DocumentList>(
          core,
          "read",
          "documents",
          "list",
          {
            place: { kind: "project", id: project },
            status: "active",
            ...(cursor === undefined ? {} : { cursor }),
          },
        );
        if (!result.ok) return result;
        for (const entry of result.value.documents) {
          // 이름 없는 문서는 address가 없어 링크로 가리킬 수 없다.
          if (entry.document.name === null) continue;
          targets.push({
            address: `${place}/${entry.document.name}`,
            title: entry.document.title,
            name: entry.document.name,
          });
        }
        if (result.value.next_cursor === null) break;
        cursor = result.value.next_cursor;
      }
      return { ok: true, value: targets };
    },

    async resolveLink(href) {
      const address = documentAddress(href);
      const reference = address === null ? null : parseAddress(address);
      if (reference === null) return { ok: true, value: null };
      const result = await call<DocumentResolve>(
        core,
        "read",
        "documents",
        "resolve",
        { reference },
      );
      return result.ok
        ? { ok: true, value: result.value.resolved.document }
        : result;
    },
  };
}
