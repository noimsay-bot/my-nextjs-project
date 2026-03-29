import { TripBoardPage } from "@/components/team-lead/trip-board-page";

export default function TeamLeadDomesticTripPage() {
  return (
    <TripBoardPage
      title="국내출장"
      travelTypes={["국내출장", "당일출장"]}
      emptyMessage="일정배정에 입력된 국내출장 또는 당일출장 내역이 없습니다."
      showAllUsers
    />
  );
}
