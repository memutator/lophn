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
  answerFromGuides,
  type GuideAnswer,
  type GuideAsk,
  type GuideText,
  sectionText,
} from "./guide-answer.ts";
export {
  oneLine,
  type PlaceCandidate,
  type PlaceRecommendations,
  type PlaceTarget,
  type QuestionDraft,
  RECOMMENDATION_LIMIT,
  recommendPlaces,
  SUPPORT_THRESHOLDS,
  type SupportingEvidence,
  supportingEvidence,
  type SupportSignals,
} from "./place-recommendation.ts";
export {
  protectedGuidance,
  settingChangeQuestion,
  type SettingProposal,
  type SettingQuestionDraft,
} from "./setting-proposal.ts";
export {
  type BundledGuideFile,
  copyBytes,
  guideBytesFromFiles,
  type GuideBytesLoader,
  loadProductGuides,
  type ProductGuides,
} from "./work.ts";
