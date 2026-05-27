import type { ElectionEvent, ElectionPointInput, ElectionStatus } from "@/lib/election/types";

type ElectionPrintPoint = ElectionEvent["points"][number] | ElectionPointInput;

const printColumns = [
  { key: "number", label: "#", className: "election-print-col-number" },
  { key: "region", label: "지역", className: "election-print-col-region" },
  { key: "place", label: "장소", className: "election-print-col-place" },
  { key: "poolVideo", label: "코리아풀영상", className: "election-print-col-pool" },
  { key: "equipmentName", label: "장비배정", className: "election-print-col-equipment" },
  { key: "trs", label: "TRS", className: "election-print-col-trs" },
  { key: "cameraStaff", label: "촬영기자", className: "election-print-col-staff" },
  { key: "audioStaff", label: "오디오맨", className: "election-print-col-staff" },
  { key: "liveTime", label: "중계시간", className: "election-print-col-time" },
  { key: "reporter", label: "취재기자", className: "election-print-col-staff" },
  { key: "address", label: "주소", className: "election-print-col-address" },
  { key: "note", label: "비고", className: "election-print-col-note" },
  { key: "livePosition", label: "중계자리", className: "election-print-col-position" },
  { key: "lan", label: "LAN", className: "election-print-col-position" },
  { key: "lighting", label: "조명", className: "election-print-col-lighting" },
] as const;

const statusLabels: Record<ElectionStatus, string> = {
  draft: "작성중",
  published: "게시중",
  closed: "최종 저장",
};

export const ELECTION_PRINT_CSS = `
  .election-print-sheet {
    width: 100%;
    min-height: 100vh;
    display: grid;
    grid-template-rows: auto 1fr;
    gap: 4mm;
    color: #111827;
    font-family: "Segoe UI", "Pretendard", "Apple SD Gothic Neo", sans-serif;
  }

  .election-print-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 8mm;
    align-items: end;
    padding-bottom: 2mm;
    border-bottom: 2px solid #111827;
    text-align: center;
  }

  .election-print-title {
    margin: 0;
    color: #0f172a;
    font-size: 19pt;
    font-weight: 900;
    line-height: 1.15;
  }

  .election-print-meta {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 2mm 4mm;
    margin-top: 2mm;
    color: #334155;
    font-size: 8.5pt;
    font-weight: 800;
  }

  .election-print-count {
    color: #0f172a;
    font-size: 9pt;
    font-weight: 900;
    text-align: center;
    white-space: nowrap;
  }

  .election-print-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }

  .election-print-table th,
  .election-print-table td {
    border: 1px solid #475569;
  }

  .election-print-table th {
    padding: 2.2mm 1mm;
    background: #dbeafe;
    color: #0f172a;
    font-size: 7.2pt;
    font-weight: 900;
    line-height: 1.1;
    text-align: center;
  }

  .election-print-table td {
    min-height: 10mm;
    padding: 1.8mm 1.2mm;
    background: #ffffff;
    font-size: 7.5pt;
    font-weight: 700;
    line-height: 1.22;
    text-align: center;
    vertical-align: middle;
    overflow-wrap: anywhere;
    word-break: keep-all;
  }

  .election-print-table tbody tr:nth-child(even) td {
    background: #f8fafc;
  }

  .election-print-region-cell {
    background: #e0f2fe !important;
    font-weight: 900;
    vertical-align: middle !important;
  }

  .election-print-col-number { width: 3.2%; }
  .election-print-col-region { width: 5.4%; }
  .election-print-col-place { width: 8%; }
  .election-print-col-pool { width: 6.2%; }
  .election-print-col-equipment { width: 7%; }
  .election-print-col-trs { width: 5.2%; }
  .election-print-col-staff { width: 7%; }
  .election-print-col-time { width: 8.5%; }
  .election-print-col-address { width: 14.6%; }
  .election-print-col-note { width: 10.8%; }
  .election-print-col-position { width: 4%; }
  .election-print-col-lighting { width: 5.6%; }

  .election-print-empty {
    color: #94a3b8;
  }

  .election-print-split {
    display: grid;
    gap: 0.8mm;
    text-align: left;
  }

  .election-print-split-row {
    display: grid;
    grid-template-columns: 7mm minmax(0, 1fr);
    gap: 1mm;
  }

  .election-print-split b {
    color: #64748b;
    font-size: 6.3pt;
    font-weight: 900;
  }

  .election-print-position {
    display: inline-block;
    width: 5mm;
    height: 5mm;
    border: 1px solid #94a3b8;
    background: #ffffff;
  }

  .election-print-position--on {
    border-color: #15803d;
    background: #22c55e;
  }
`;

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function printableValue(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed ? escapeHtml(trimmed) : '<span class="election-print-empty">-</span>';
}

function splitValue(morning: string | null | undefined, afternoon: string | null | undefined) {
  const morningText = morning?.trim() ?? "";
  const afternoonText = afternoon?.trim() ?? "";
  if (!afternoonText) return printableValue(morningText);

  return `
    <div class="election-print-split">
      <div class="election-print-split-row"><b>오전</b><span>${printableValue(morningText)}</span></div>
      <div class="election-print-split-row"><b>오후</b><span>${printableValue(afternoonText)}</span></div>
    </div>
  `;
}

function isLivePositionChecked(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized === "checked" || normalized === "true" || normalized === "yes" || normalized === "1";
}

function buildPrintPointGroups(points: ElectionPrintPoint[]) {
  const groups: Array<{ region: string; points: ElectionPrintPoint[] }> = [];

  points.forEach((point) => {
    const region = point.region.trim();
    const previousGroup = groups.at(-1);
    if (previousGroup && previousGroup.region === region) {
      previousGroup.points.push(point);
      return;
    }

    groups.push({ region, points: [point] });
  });

  return groups;
}

function renderPointRow(point: ElectionPrintPoint, index: number, regionCellHtml: string) {
  const livePositionClassName = isLivePositionChecked(point.livePosition)
    ? "election-print-position election-print-position--on"
    : "election-print-position";
  const lanClassName = isLivePositionChecked(point.lan)
    ? "election-print-position election-print-position--on"
    : "election-print-position";

  return `
    <tr>
      <td>${index + 1}</td>
      ${regionCellHtml}
      <td>${printableValue(point.place)}</td>
      <td>${printableValue(point.poolVideo)}</td>
      <td>${printableValue(point.equipmentName)}</td>
      <td>${printableValue(point.trs)}</td>
      <td>${splitValue(point.cameraStaffName, point.cameraStaffNamePm)}</td>
      <td>${splitValue(point.audioStaffName, point.audioStaffNamePm)}</td>
      <td>${splitValue(point.liveTime, point.liveTimePm)}</td>
      <td>${splitValue(point.reporterName, point.reporterNamePm)}</td>
      <td>${printableValue(point.address)}</td>
      <td>${printableValue(point.note)}</td>
      <td><span class="${livePositionClassName}"></span></td>
      <td><span class="${lanClassName}"></span></td>
      <td>${printableValue(point.lighting)}</td>
    </tr>
  `;
}

export function renderElectionPrintHtml({
  title,
  electionDate,
  status,
  points,
}: {
  title: string;
  electionDate: string;
  status: ElectionStatus;
  points: ElectionPrintPoint[];
}) {
  let pointIndex = 0;
  const rowsHtml = points.length
    ? buildPrintPointGroups(points)
        .flatMap((group) =>
          group.points.map((point, groupPointIndex) => {
            const regionCellHtml =
              groupPointIndex === 0
                ? `<td class="election-print-region-cell" rowspan="${group.points.length}">${printableValue(group.region)}</td>`
                : "";
            const rowHtml = renderPointRow(point, pointIndex, regionCellHtml);
            pointIndex += 1;
            return rowHtml;
          }),
        )
        .join("")
    : `<tr><td colspan="${printColumns.length}"><span class="election-print-empty">입력된 중계 포인트가 없습니다.</span></td></tr>`;

  return `
    <section class="election-print-sheet" data-print-frame="true">
      <header class="election-print-header">
        <div>
          <h1 class="election-print-title">${escapeHtml(title)}</h1>
          <div class="election-print-meta">
            <span>선거일 ${printableValue(electionDate)}</span>
            <span>상태 ${escapeHtml(statusLabels[status])}</span>
          </div>
        </div>
        <div class="election-print-count">${points.length}개 포인트</div>
      </header>
      <table class="election-print-table">
        <thead>
          <tr>${printColumns.map((column) => `<th class="${column.className}">${escapeHtml(column.label)}</th>`).join("")}</tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </section>
  `;
}
