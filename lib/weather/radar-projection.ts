export type RadarOverlayBounds = [[number, number], [number, number]];

export type RadarProjectionInput = {
  layerCoverageStartProjX: number | null;
  layerCoverageStartProjY: number | null;
  layerCoverageEndProjX: number | null;
  layerCoverageEndProjY: number | null;
  imageCoverageStartProjX: number | null;
  imageCoverageStartProjY: number | null;
  imageCoverageEndProjX: number | null;
  imageCoverageEndProjY: number | null;
};

const WEB_MERCATOR_RADIUS_M = 6378137;
const KMA_RADAR_REFERENCE_LONGITUDE = 126;
const KOREA_DOMAIN = {
  minLat: 30,
  maxLat: 43,
  minLng: 120,
  maxLng: 136,
};

function hasBounds(values: Array<number | null>): values is [number, number, number, number] {
  return values.every((value) => typeof value === "number" && Number.isFinite(value));
}

function projectedPointToLatLng(x: number, y: number) {
  const lng = KMA_RADAR_REFERENCE_LONGITUDE + (x / WEB_MERCATOR_RADIUS_M) * (180 / Math.PI);
  const lat = (Math.atan(Math.sinh(y / WEB_MERCATOR_RADIUS_M)) * 180) / Math.PI;
  return { lat, lng };
}

function isKoreaDomainBounds(bounds: RadarOverlayBounds) {
  const [[south, west], [north, east]] = bounds;
  return (
    south >= KOREA_DOMAIN.minLat &&
    north <= KOREA_DOMAIN.maxLat &&
    west >= KOREA_DOMAIN.minLng &&
    east <= KOREA_DOMAIN.maxLng &&
    south < north &&
    west < east
  );
}

function toOverlayBounds(startX: number, startY: number, endX: number, endY: number) {
  const start = projectedPointToLatLng(startX, startY);
  const end = projectedPointToLatLng(endX, endY);
  const bounds: RadarOverlayBounds = [
    [Math.min(start.lat, end.lat), Math.min(start.lng, end.lng)],
    [Math.max(start.lat, end.lat), Math.max(start.lng, end.lng)],
  ];
  return isKoreaDomainBounds(bounds) ? bounds : null;
}

export function getRadarOverlayBounds(input: RadarProjectionInput) {
  const layerValues = [
    input.layerCoverageStartProjX,
    input.layerCoverageStartProjY,
    input.layerCoverageEndProjX,
    input.layerCoverageEndProjY,
  ];
  if (hasBounds(layerValues)) {
    const bounds = toOverlayBounds(...layerValues);
    if (bounds) return bounds;
  }

  const imageValues = [
    input.imageCoverageStartProjX,
    input.imageCoverageStartProjY,
    input.imageCoverageEndProjX,
    input.imageCoverageEndProjY,
  ];
  if (!hasBounds(imageValues)) return null;
  return toOverlayBounds(...imageValues);
}
