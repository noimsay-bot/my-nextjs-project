import { TripBoardPage } from "@/components/team-lead/trip-board-page";

export default function DeskInternationalTripPage() {
  return (
    <TripBoardPage
      title="해외출장"
      travelTypes={["해외출장"]}
      emptyMessage="일정배정에 입력된 해외출장 내역이 없습니다."
      showAllUsers
    />
  );
}
