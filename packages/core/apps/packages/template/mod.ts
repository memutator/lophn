// apps/sdk 앱 템플릿의 경계다. 코드 원본은 template/app/의 `.tmpl`이다.
export {
  builtinTemplate,
  readTemplateDirectory,
  REQUIRED_TEMPLATE_FILES,
  type TemplateFailure,
  type TemplateFile,
  templateHash,
} from "./files.ts";
export {
  type ResolvedTemplate,
  resolveTemplate,
  type ResolveTemplateInput,
  type TemplateSource,
} from "./resolve.ts";
export {
  DEV_IMPORT_MAP_PATH,
  scaffoldApp,
  type ScaffoldInput,
  type ScaffoldResult,
} from "./scaffold.ts";
export {
  buildImportMap,
  devImportMap,
  type ImportMap,
  type ImportMapInput,
  type ImportMapResult,
  type PackageRef,
} from "./import-map.ts";
export { TEMPLATE_HASH, TEMPLATE_ROOTS } from "./pin.ts";
