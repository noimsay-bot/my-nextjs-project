import { HomeNewsDataset } from "@/components/home/home-news.types";
import { buildHomeNewsDataset, HomeNewsBriefingRecord } from "@/lib/home-news/transform";

export function buildHomeNewsIssueSetDataset(
  records: HomeNewsBriefingRecord[],
  issueSet: NonNullable<HomeNewsDataset["issueSet"]>,
  now = new Date(),
) {
  return buildHomeNewsDataset(records, now, {
    respectInputOrder: true,
    filterInactive: false,
    sourceKind: "official_issue_set",
    issueSet,
  });
}
