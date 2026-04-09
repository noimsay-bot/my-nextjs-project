import { createDefaultNewsBriefingFormValues, NewsBriefingFormValues, NewsBriefingPriority } from "@/lib/home-news/admin-types";
import { HomeNewsBriefingSlot, HomeNewsEventStage } from "@/lib/home-news/transform";
import { HomeNewsCategory } from "@/components/home/home-news.types";

export type NewsAIDraftRequestInput = {
  category: HomeNewsCategory;
  briefingSlot: HomeNewsBriefingSlot;
  referenceText: string;
  relatedKeywords: string;
  eventStage: Exclude<HomeNewsEventStage, null> | "";
  eventTime: string;
  publishedTime: string;
  sourceLabel: string;
  priorityHint: NewsBriefingPriority | "";
  recommendationReason: string;
  importanceHints: string[];
  personalizationHints: string[];
};

export type NewsAIDraftResult = {
  title: string;
  summaryLines: string[];
  whyItMatters: string;
  checkPoints: string[];
  tags: string[];
  priority: NewsBriefingPriority;
  briefingText: string;
};

export type NewsAIDraftResponse = {
  ok: boolean;
  message: string;
  draft?: NewsAIDraftResult;
};

export function createDefaultNewsAIDraftRequest(values?: Partial<NewsBriefingFormValues>): NewsAIDraftRequestInput {
  const defaults = createDefaultNewsBriefingFormValues();
  return {
    category: values?.category ?? defaults.category,
    briefingSlot: values?.briefingSlot ?? defaults.briefingSlot,
    referenceText: "",
    relatedKeywords: "",
    eventStage: values?.eventStage ?? "",
    eventTime: values?.occurredAt ?? "",
    publishedTime: values?.publishedAt ?? "",
    sourceLabel: values?.sourceLabel ?? "",
    priorityHint: values?.priority ?? "",
    recommendationReason: "",
    importanceHints: [],
    personalizationHints: [],
  };
}

export function applyDraftToNewsFormValues(
  currentValues: NewsBriefingFormValues,
  draft: NewsAIDraftResult,
  mode: "overwrite" | "fill_empty",
): NewsBriefingFormValues {
  const summary = draft.summaryLines.join("\n");
  const checkPoints = draft.checkPoints.join("\n");
  const tags = draft.tags.join(", ");
  const nextValues = {
    ...currentValues,
    title: draft.title,
    summary,
    whyItMatters: draft.whyItMatters,
    checkPoints,
    tags,
    priority: draft.priority,
    briefingText: draft.briefingText,
  } satisfies NewsBriefingFormValues;

  if (mode === "overwrite") {
    return nextValues;
  }

  return {
    ...currentValues,
    title: currentValues.title.trim() ? currentValues.title : nextValues.title,
    summary: currentValues.summary.trim() ? currentValues.summary : nextValues.summary,
    whyItMatters: currentValues.whyItMatters.trim() ? currentValues.whyItMatters : nextValues.whyItMatters,
    checkPoints: currentValues.checkPoints.trim() ? currentValues.checkPoints : nextValues.checkPoints,
    tags: currentValues.tags.trim() ? currentValues.tags : nextValues.tags,
    priority: nextValues.priority,
    briefingText: currentValues.briefingText.trim() ? currentValues.briefingText : nextValues.briefingText,
  };
}
