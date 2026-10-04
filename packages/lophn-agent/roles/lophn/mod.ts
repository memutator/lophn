export {
  GUIDE_MEDIA_TYPE,
  GUIDE_SOURCES,
  type GuideSection,
  type GuideSource,
  guideSource,
} from "./guides/catalog.ts";
export {
  decodeGuideUtf8,
  guideSections,
  markdownSections,
  type PreparedGuideText,
  prepareGuideText,
  requireLophnVersion,
  sectionHeading,
} from "./model.ts";
export {
  explainSetting,
  type SettingExplanation,
  type SettingExplanationInput,
} from "./settings-explanation.ts";
export {
  type BundledGuideFile,
  copyBytes,
  guideBytesFromFiles,
  type GuideBytesLoader,
  loadProductGuides,
  type ProductGuides,
} from "./work.ts";
