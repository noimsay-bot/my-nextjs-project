export interface WeatherDispatchPoint {
  name: string;
  lat: number;
  lon: number;
}

export interface WeatherDispatchCandidate extends WeatherDispatchPoint {
  id: string;
  shootingSuitability: number;
  caution?: string;
}

export const SANGAM_BASE = {
  name: "상암동 DMC",
  // 실제 회사 좌표에 맞게 조정 가능
  lat: 37.5796,
  lon: 126.8908,
} as const satisfies WeatherDispatchPoint;

export const WEATHER_DISPATCH_CANDIDATES: WeatherDispatchCandidate[] = [
  {
    id: "sangam-dmc",
    name: "상암DMC",
    lat: 37.5796,
    lon: 126.8908,
    shootingSuitability: 0.86,
    caution: "사무실과 가까워 빠른 출동은 가능하지만 화면 변화가 단조로울 수 있습니다.",
  },
  {
    id: "worldcup-stadium",
    name: "월드컵경기장",
    lat: 37.5682,
    lon: 126.8975,
    shootingSuitability: 0.9,
  },
  {
    id: "mangwon-hangang",
    name: "망원한강공원",
    lat: 37.5553,
    lon: 126.8956,
    shootingSuitability: 0.94,
    caution: "한강변은 강풍과 침수 위험을 함께 확인해야 합니다.",
  },
  {
    id: "yeouido",
    name: "여의도",
    lat: 37.5259,
    lon: 126.9255,
    shootingSuitability: 0.92,
  },
  {
    id: "gwanghwamun",
    name: "광화문",
    lat: 37.572,
    lon: 126.9769,
    shootingSuitability: 0.88,
  },
  {
    id: "seoul-station",
    name: "서울역",
    lat: 37.5547,
    lon: 126.9707,
    shootingSuitability: 0.84,
  },
  {
    id: "yongsan",
    name: "용산",
    lat: 37.5326,
    lon: 126.9905,
    shootingSuitability: 0.86,
  },
  {
    id: "eunpyeong-bulgwang",
    name: "은평 불광",
    lat: 37.6104,
    lon: 126.9298,
    shootingSuitability: 0.8,
  },
  {
    id: "gimpo-magok",
    name: "김포공항/마곡",
    lat: 37.5658,
    lon: 126.8027,
    shootingSuitability: 0.87,
    caution: "공항 주변 촬영 제한 구역과 항공기 소음을 확인해야 합니다.",
  },
  {
    id: "goyang-hwajeong",
    name: "고양 화정",
    lat: 37.6349,
    lon: 126.8323,
    shootingSuitability: 0.78,
  },
  {
    id: "ilsan-kintex",
    name: "일산 킨텍스",
    lat: 37.6688,
    lon: 126.745,
    shootingSuitability: 0.84,
  },
  {
    id: "bucheon-sangdong",
    name: "부천 상동",
    lat: 37.5056,
    lon: 126.753,
    shootingSuitability: 0.78,
  },
  {
    id: "paju-unjeong",
    name: "파주 운정",
    lat: 37.725,
    lon: 126.7586,
    shootingSuitability: 0.82,
    caution: "현재 위치에 따라 이동권 끝단일 수 있어 실제 교통 상황을 별도로 확인해야 합니다.",
  },
];
