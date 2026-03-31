export interface ReviewRubricCriterion {
  id: string;
  label: string;
  score: number;
}

export interface ReviewRubricSection {
  title: string;
  isBonus?: boolean;
  criteria: ReviewRubricCriterion[];
}

export const reviewRubrics: Record<string, ReviewRubricSection[]> = {
  일반리포트: [
    { title: "기사 주제와의 정합성", criteria: [
      { id: "general-topic-1", label: "영상이 기사 핵심 내용과 직관적으로 매칭되는가", score: 3 },
      { id: "general-topic-2", label: "전개 흐름에 맞는 컷 구성과 연결이 자연스러운가", score: 3 },
    ]},
    { title: "기술적 완성도 및 기본기", criteria: [
      { id: "general-tech-1", label: "수평·수직·사이즈·헤드룸 등이 안정적인가", score: 2 },
      { id: "general-tech-2", label: "화이트발란스·노출·초점이 정확하고 현장 오디오가 명료한가", score: 3 },
    ]},
    { title: "기본 영상 확보 및 현장 커버리지", criteria: [
      { id: "general-coverage-1", label: "기사 구성에 필요한 사이즈별 영상이 충분한가", score: 3 },
      { id: "general-coverage-2", label: "인서트 및 상황 설명 화면을 적절히 확보했는가", score: 3 },
    ]},
    { title: "현장활용 및 대응력", criteria: [
      { id: "general-response-1", label: "제한된 환경 속에서 최적의 앵글과 배경을 선택했는가", score: 3 },
    ]},
    { title: "(가점) 플랫폼 확장성 / 대응", isBonus: true, criteria: [
      { id: "general-bonus-1", label: "모바일라이브 또는 컨텐츠 제작에 선제대응 하였는가", score: 1 },
      { id: "general-bonus-2", label: "현장 돌발 상황에 유연하게 대응했는가", score: 1 },
    ]},
  ],
  기획리포트: [
    { title: "메시지 전달력 및 스토리텔링", criteria: [
      { id: "plan-message-1", label: "영상이 기획 의도와 핵심 메시지를 명확히 전달하는가", score: 3 },
      { id: "plan-message-2", label: "화면 호흡과 흐름이 자연스럽고 몰입도가 있는가", score: 3 },
    ]},
    { title: "영상 표현력", criteria: [
      { id: "plan-visual-1", label: "심도·프레이밍·카메라 무빙이 의도적으로 설계되었는가", score: 3 },
      { id: "plan-visual-2", label: "인물 심리와 현장 상황을 고려한 프레임 구성인가", score: 3 },
    ]},
    { title: "빛, 공간 해석 능력", criteria: [
      { id: "plan-space-1", label: "자연광·조명을 전략적으로 활용했는가", score: 3 },
      { id: "plan-space-2", label: "공간을 입체적으로 활용해 주제를 강화했는가", score: 3 },
    ]},
    { title: "오디오·현장감 완성도", criteria: [
      { id: "plan-audio-1", label: "인터뷰이 오디오가 선명하고 현장의 음향을 의도적으로 컨트롤 하였는가", score: 2 },
    ]},
    { title: "(가점) 차별,창의성 / 확장성", isBonus: true, criteria: [
      { id: "plan-bonus-1", label: "동일 사안 대비 독창적 영상 접근이 있는가", score: 1 },
      { id: "plan-bonus-2", label: "확장성(추가 콘텐츠 제작)을 고려하여 구성하였나", score: 1 },
    ]},
  ],
  인터뷰리포트: [
    { title: "구도 안정성", criteria: [
      { id: "interview-frame-1", label: "주제와 어울리는적절한 사이즈와 어울리는 배경을 선정했는가", score: 5 },
    ]},
    { title: "인물 부각 및 배경 선택", criteria: [
      { id: "interview-frame-2", label: "조명·자연광을 활용해 인물을 효과적으로 부각했는가", score: 5 },
    ]},
    { title: "오디오 완성도", criteria: [
      { id: "interview-audio-1", label: "목소리를 노이즈 없이 명료하게 수음했는가", score: 5 },
    ]},
    { title: "내용 보완 화면 확보", criteria: [
      { id: "interview-insert-1", label: "제스처·반응 컷 등 인서트를 충분히 확보했는가", score: 5 },
    ]},
    { title: "(가점) 진행 완성도", isBonus: true, criteria: [
      { id: "interview-bonus-1", label: "로드 인터뷰·돌발 상황에서 구도 유지와 피벗팅이 매끄러운가", score: 1 },
      { id: "interview-bonus-2", label: "다인 인터뷰 시 균형이 유지되는가", score: 1 },
    ]},
  ],
  LIVE: [
    { title: "시각적 현장성", criteria: [
      { id: "live-visual-1", label: "보도 주제를 가장 잘 설명하는 배경을 선택했는가", score: 4 },
      { id: "live-visual-2", label: "주·야간 환경에서 기자(혹은 주요 피사체)가 선명히 표현되는가", score: 3 },
    ]},
    { title: "기술 안정성", criteria: [
      { id: "live-tech-1", label: "화면 수평·구도가 안정적인가", score: 3 },
      { id: "live-tech-2", label: "송출 신호·화질이 안정적인가", score: 3 },
    ]},
    { title: "오디오 명료성", criteria: [
      { id: "live-audio-1", label: "취재기자 또는 출연자의 음성과 현장음이 혼선 없이 전달되는가", score: 3 },
    ]},
    { title: "카메라 운용 능력", criteria: [
      { id: "live-camera-1", label: "현장의 지형·지물을 효율적으로 활용 하였는가", score: 4 },
    ]},
    { title: "(가점) 디지털 확장성 / 대응", isBonus: true, criteria: [
      { id: "live-bonus-1", label: "워크앤토크·이동 동선에 맞는 매끄러운 무빙인가", score: 1 },
      { id: "live-bonus-2", label: "현장 돌발 상황에 즉각 대응했는가", score: 1 },
    ]},
  ],
};

export function getBonusCriterionIds(reportType: string) {
  return (reviewRubrics[reportType] ?? [])
    .filter((section) => section.isBonus)
    .flatMap((section) => section.criteria.map((criterion) => criterion.id));
}

export function getAllowedCriterionIds(reportType: string) {
  return (reviewRubrics[reportType] ?? [])
    .flatMap((section) => section.criteria.map((criterion) => criterion.id));
}
