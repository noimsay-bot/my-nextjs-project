import { ManualScoreBoardPage } from "@/components/team-lead/manual-score-board-page";

export default function TeamLeadLiveSafetyPage() {
  return (
    <ManualScoreBoardPage
      title="LIVE무사고"
      description="LIVE무사고 점수는 사람별 기본 20점에서 현장 운영 결과에 따라 점수를 가감합니다."
      category="liveSafety"
    />
  );
}
