import { ExternalNewsBatch, ExternalNewsCandidate, ExternalNewsWorkspace } from "@/lib/home-news/external-source-types";
import { getHomeNewsSlotTimeWindow } from "@/lib/home-news/current-issue-set";
import { HomeNewsBriefingSlot } from "@/lib/home-news/transform";
import { toNewsTimestamp } from "@/lib/home-news/ranking";

function getKstHour(value: string | null | undefined) {
  const timestamp = toNewsTimestamp(value);
  if (!timestamp) return null;
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      hour12: false,
    }).format(new Date(timestamp)),
  );
}

function getSlotAffinityScore(candidate: ExternalNewsCandidate, slot: HomeNewsBriefingSlot) {
  const eventHour = getKstHour(candidate.occurredAt ?? candidate.publishedAt);
  let score = candidate.slotHints.includes(slot) ? 24 : 0;

  if (eventHour === null) {
    return score;
  }

  if (slot === "morning_6") {
    if (eventHour < 6) score += 28;
    else if (eventHour < 12) score += 18;
    else if (eventHour < 18) score += 8;
  } else {
    if (eventHour >= 12 && eventHour < 18) score += 24;
    else if (eventHour >= 18) score += 16;
    else if (eventHour >= 6) score += 10;
  }

  return score;
}

function toBatchHeadline(slot: HomeNewsBriefingSlot, count: number) {
  if (slot === "morning_6") {
    return count > 0 ? "오전 6시 브리핑용 우선 검토 후보" : "오전 6시용 후보가 아직 없습니다.";
  }
  return count > 0 ? "오후 3시 브리핑용 우선 검토 후보" : "오후 3시용 후보가 아직 없습니다.";
}

function isWithinSlotWindow(candidate: ExternalNewsCandidate, slot: HomeNewsBriefingSlot, generatedAt: Date) {
  const referenceTimestamp = toNewsTimestamp(candidate.occurredAt ?? candidate.publishedAt);
  if (!referenceTimestamp) return false;

  const { startsAt, endsAt } = getHomeNewsSlotTimeWindow(slot, generatedAt);
  return referenceTimestamp >= startsAt.getTime() && referenceTimestamp < endsAt.getTime();
}

function buildBatch(slot: HomeNewsBriefingSlot, candidates: ExternalNewsCandidate[], generatedAt: Date): ExternalNewsBatch {
  const items = candidates
    .filter((candidate) => isWithinSlotWindow(candidate, slot, generatedAt))
    .map((candidate) => ({
      candidate: {
        ...candidate,
        suggestedSlot: slot,
      },
      slotScore: getSlotAffinityScore(candidate, slot),
    }))
    .sort((left, right) => (right.candidate.score + right.slotScore) - (left.candidate.score + left.slotScore))
    .slice(0, 6)
    .map(({ candidate }) => candidate);

  return {
    slot,
    headline: toBatchHeadline(slot, items.length),
    items,
  };
}

export function buildExternalNewsWorkspace(
  generatedAt: Date,
  candidates: ExternalNewsCandidate[],
  trendHints: string[],
): ExternalNewsWorkspace {
  const morningBatch = buildBatch("morning_6", candidates, generatedAt);
  const afternoonBatch = buildBatch("afternoon_3", candidates, generatedAt);

  return {
    generatedAt: generatedAt.toISOString(),
    trendHints,
    candidates,
    batches: {
      morning_6: morningBatch,
      afternoon_3: afternoonBatch,
    },
  };
}
