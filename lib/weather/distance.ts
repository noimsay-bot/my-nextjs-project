const EARTH_RADIUS_KM = 6371;

export function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function getHaversineDistanceKm(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
) {
  const latDelta = toRadians(to.lat - from.lat);
  const lonDelta = toRadians(to.lon - from.lon);
  const fromLat = toRadians(from.lat);
  const toLat = toRadians(to.lat);

  const a =
    Math.sin(latDelta / 2) * Math.sin(latDelta / 2) +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(lonDelta / 2) * Math.sin(lonDelta / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_KM * c;
}

export type WeatherTravelBandMinutes = 10 | 20 | 30 | 45 | 60;

export function getTravelBandMinutes(distanceKm: number): WeatherTravelBandMinutes | null {
  if (distanceKm <= 4) return 10;
  if (distanceKm <= 8) return 20;
  if (distanceKm <= 12) return 30;
  if (distanceKm <= 22) return 45;
  if (distanceKm <= 35) return 60;
  return null;
}
