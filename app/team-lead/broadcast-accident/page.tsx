import { ManualScoreBoardPage } from "@/components/team-lead/manual-score-board-page";

export default function TeamLeadBroadcastAccidentPage() {
  return (
    <ManualScoreBoardPage
      title="장비/인적 사고"
      description="장비/인적 사고 점수는 사람별 기본 20점에서 사고/성과 항목을 가감해 관리합니다."
      category="broadcastAccident"
    />
  );
}
