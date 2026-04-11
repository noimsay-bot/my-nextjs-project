import { RestaurantDetailPage } from "@/components/restaurants/restaurant-detail-page";

export default async function RestaurantDetailRoutePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RestaurantDetailPage restaurantId={id} />;
}
