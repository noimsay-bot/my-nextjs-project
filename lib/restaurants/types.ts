export interface RestaurantRow {
  id: string;
  name: string;
  address: string | null;
  note: string | null;
  placeId: string | null;
  lat: number;
  lng: number;
  authorId: string;
  authorName: string | null;
  createdAt: string;
}

export interface RestaurantLocation {
  lat: number;
  lng: number;
}

export interface NearbyRestaurant extends RestaurantRow {
  distanceMeters: number | null;
}

export type RestaurantLocationStatus =
  | "idle"
  | "requesting"
  | "locating"
  | "ready"
  | "denied"
  | "error";

export type GeolocationPermissionState =
  | "checking"
  | "prompt"
  | "requesting"
  | "granted"
  | "denied"
  | "unsupported"
  | "error";

export interface UserLocationState {
  permissionState: GeolocationPermissionState;
  status: RestaurantLocationStatus;
  location: RestaurantLocation | null;
  message: string;
}

export interface RestaurantCreateInput {
  name: string;
  address: string;
  note: string;
  placeId: string;
  lat: string;
  lng: string;
}

export interface RestaurantCommentRow {
  id: string;
  restaurantId: string;
  authorId: string;
  authorName: string | null;
  content: string;
  createdAt: string;
}

export interface RestaurantCommentCreateInput {
  content: string;
}

export interface RestaurantDetailData {
  restaurant: RestaurantRow | null;
  comments: RestaurantCommentRow[];
}
