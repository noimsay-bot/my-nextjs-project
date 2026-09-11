// Draft and published JSON share one row version, but are loaded independently.
// Only a successful local write may advance the other view's matching version.
// Sharing arbitrary read versions would hide another user's intervening edit.
export const draftMonthVersions = new Map<string, string | null>();
export const publishedMonthVersions = new Map<string, string | null>();

export function advanceScheduleMonthVersion(
  source: "draft" | "published",
  monthKey: string,
  previousVersion: string | null | undefined,
  nextVersion: string | null,
) {
  const own = source === "draft" ? draftMonthVersions : publishedMonthVersions;
  const other = source === "draft" ? publishedMonthVersions : draftMonthVersions;
  own.set(monthKey, nextVersion);
  if (other.has(monthKey) && other.get(monthKey) === previousVersion) {
    other.set(monthKey, nextVersion);
  }
}
