"use client";

import { NewsBriefingAdminRecord } from "@/lib/home-news/admin-types";
import { buildNewsBriefingRecommendationWorkspace } from "@/lib/home-news/recommendation-scoring";

export function getNewsBriefingRecommendationWorkspace(
  records: NewsBriefingAdminRecord[],
  now = new Date(),
) {
  return buildNewsBriefingRecommendationWorkspace(records, now);
}
