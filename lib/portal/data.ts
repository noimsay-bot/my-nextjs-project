export type ReportType = "일반리포트" | "기획리포트" | "인터뷰리포트" | "LIVE";

export interface SubmissionCard {
  id: string;
  type: ReportType;
  title: string;
  link: string;
  date: string;
  comment: string;
}

export interface SubmissionEntry {
  submitter: string;
  cards: SubmissionCard[];
  updatedAt: string;
}

export interface ScoreCriterion {
  id: string;
  label: string;
  score: number;
}

export interface ScoreSection {
  title: string;
  criteria: ScoreCriterion[];
}

export const submissionStorageKey = "j-special-force-submissions-v1";
export const reviewStorageKey = "j-special-force-reviews-v1";

export const reportTemplates: Record<ReportType, ScoreSection[]> = {
  일반리포트: [
    {
      title: "기사 주제와의 정합성",
      criteria: [
        { id: "general-topic-1", label: "기사 핵심과 영상 매칭", score: 3 },
        { id: "general-topic-2", label: "컷 구성과 연결 자연스러움", score: 3 },
      ],
    },
    {
      title: "기술적 완성도",
      criteria: [
        { id: "general-tech-1", label: "수평·수직·헤드룸 안정", score: 2 },
        { id: "general-tech-2", label: "노출·초점·오디오 정확", score: 3 },
      ],
    },
  ],
  기획리포트: [
    {
      title: "메시지 전달력",
      criteria: [
        { id: "plan-msg-1", label: "기획 의도 전달", score: 3 },
        { id: "plan-msg-2", label: "화면 호흡과 몰입도", score: 3 },
      ],
    },
    {
      title: "영상 표현력",
      criteria: [
        { id: "plan-visual-1", label: "카메라 무빙 설계", score: 3 },
        { id: "plan-visual-2", label: "프레임 구성", score: 3 },
      ],
    },
  ],
  인터뷰리포트: [
    {
      title: "인터뷰 안정성",
      criteria: [
        { id: "interview-1", label: "구도 안정성", score: 5 },
        { id: "interview-2", label: "배경과 인물 부각", score: 5 },
      ],
    },
    {
      title: "콘텐츠 보강",
      criteria: [
        { id: "interview-3", label: "오디오 완성도", score: 5 },
        { id: "interview-4", label: "인서트 확보", score: 5 },
      ],
    },
  ],
  LIVE: [
    {
      title: "현장성",
      criteria: [
        { id: "live-1", label: "주제 설명 배경 선택", score: 4 },
        { id: "live-2", label: "기자/피사체 선명도", score: 3 },
      ],
    },
    {
      title: "기술 안정성",
      criteria: [
        { id: "live-3", label: "구도 안정", score: 3 },
        { id: "live-4", label: "송출 안정", score: 3 },
      ],
    },
  ],
};
