"use client";

import { useEffect, useRef, useState } from "react";
import {
  addDaysToDateKey,
  getKstDateKey,
  getKstDayRange,
  getMondayBasedWeekday,
  getWeekStartDateKey,
  isDateKey,
} from "@/lib/youtube-lives/periods";
import { listCheckedLivesForReport, type WeeklyReportLive } from "@/lib/youtube-lives/storage";

const WEEKDAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
const IMAGE_COLUMNS = 6;
const THUMB_WIDTH = 480;
const THUMB_HEIGHT = 270;
const IMAGE_GAP = 8;
const IMAGE_BORDER = 4;
const REPORT_RED = "#e11d48";

function getShortDate(dateKey: string) {
  const [, month, day] = dateKey.split("-").map(Number);
  return `${month}/${day}`;
}

/** 유튜브 제목의 머리말·꼬리말(예: [현장영상], (25.11.10), / JTBC News)을 걷어낸다. 남은 문구는 화면에서 손본다. */
function cleanLiveTitle(title: string) {
  return title
    .replace(/^\s*(\[[^\]]*\]\s*)+/, "")
    .replace(/\s*[/|]\s*JTBC\s*News\s*$/i, "")
    .replace(/\s*\(\d{2}\.\d{1,2}\.\d{1,2}\)\s*$/, "")
    .trim();
}

function buildWeekdayCounts(lives: WeeklyReportLive[]) {
  const counts = WEEKDAY_LABELS.map(() => 0);
  for (const live of lives) counts[getMondayBasedWeekday(getKstDateKey(live.startedAt))] += 1;
  return counts;
}

function buildReportText(weekStart: string, lives: WeeklyReportLive[], counts: number[]) {
  const weekEnd = addDaysToDateKey(weekStart, 6);
  const lines = lives
    .filter((live) => live.reportSelected)
    .map((live) => `- ${getShortDate(getKstDateKey(live.startedAt))} ${cleanLiveTitle(live.title)} 모바일라이브 지원.`);
  const breakdown = WEEKDAY_LABELS.map((label, index) => `${label} ${counts[index]}`).join(", ");
  lines.push(
    `- ${getShortDate(weekStart)}~${getShortDate(weekEnd)} 모바일라이브 지원 : 총 ${lives.length}회 지원(${breakdown}).`,
  );
  return lines.join("\n");
}

function loadThumbnail(videoId: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    // i.ytimg.com은 Access-Control-Allow-Origin: * 을 보내므로 canvas가 오염되지 않는다.
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
  });
}

async function drawThumbnailSheet(canvas: HTMLCanvasElement, lives: WeeklyReportLive[]) {
  const columns = Math.min(IMAGE_COLUMNS, lives.length);
  const rows = Math.ceil(lives.length / IMAGE_COLUMNS);
  const cellWidth = THUMB_WIDTH + IMAGE_BORDER * 2;
  const cellHeight = THUMB_HEIGHT + IMAGE_BORDER * 2;
  canvas.width = IMAGE_GAP + columns * (cellWidth + IMAGE_GAP);
  canvas.height = IMAGE_GAP + rows * (cellHeight + IMAGE_GAP);

  const context = canvas.getContext("2d");
  if (!context) throw new Error("이미지를 만들 수 없는 브라우저입니다.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  const images = await Promise.all(lives.map((live) => loadThumbnail(live.videoId)));
  images.forEach((image, index) => {
    const x = IMAGE_GAP + (index % IMAGE_COLUMNS) * (cellWidth + IMAGE_GAP);
    const y = IMAGE_GAP + Math.floor(index / IMAGE_COLUMNS) * (cellHeight + IMAGE_GAP);
    context.fillStyle = REPORT_RED;
    context.fillRect(x, y, cellWidth, cellHeight);
    if (!image) {
      context.fillStyle = "#1f2937";
      context.fillRect(x + IMAGE_BORDER, y + IMAGE_BORDER, THUMB_WIDTH, THUMB_HEIGHT);
      return;
    }
    // hqdefault(4:3)의 위아래 검은 띠를 잘라 16:9로 맞춘다.
    const sourceHeight = (image.naturalWidth * 9) / 16;
    const sourceY = (image.naturalHeight - sourceHeight) / 2;
    context.drawImage(
      image,
      0,
      sourceY,
      image.naturalWidth,
      sourceHeight,
      x + IMAGE_BORDER,
      y + IMAGE_BORDER,
      THUMB_WIDTH,
      THUMB_HEIGHT,
    );
  });
}

export function MobileLiveReportPage() {
  const [weekStart, setWeekStart] = useState(() => getWeekStartDateKey(getKstDateKey()));
  const [lives, setLives] = useState<WeeklyReportLive[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [text, setText] = useState("");
  const [imageReady, setImageReady] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const weekEnd = addDaysToDateKey(weekStart, 6);
  const reportLives = lives.filter((live) => live.reportSelected);
  const counts = buildWeekdayCounts(lives);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setMessage("");
      setNotice("");
      try {
        const { startIso } = getKstDayRange(weekStart);
        const { endIso } = getKstDayRange(addDaysToDateKey(weekStart, 6));
        const nextLives = await listCheckedLivesForReport(startIso, endIso);
        if (!active) return;
        setLives(nextLives);
        setText(buildReportText(weekStart, nextLives, buildWeekdayCounts(nextLives)));
      } catch (error) {
        if (!active) return;
        setLives([]);
        setText("");
        setMessage(error instanceof Error ? error.message : "보고서 자료를 불러오지 못했습니다.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [weekStart]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const selected = lives.filter((live) => live.reportSelected);
    setImageReady(false);
    if (!canvas || selected.length === 0) return;
    let active = true;
    void drawThumbnailSheet(canvas, selected)
      .then(() => {
        if (active) setImageReady(true);
      })
      .catch((error: unknown) => {
        if (active) setMessage(error instanceof Error ? error.message : "이미지를 만들지 못했습니다.");
      });
    return () => {
      active = false;
    };
  }, [lives]);

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("텍스트를 복사했습니다.");
    } catch {
      setNotice("복사하지 못했습니다. 텍스트를 직접 선택해 복사해 주세요.");
    }
  };

  const copyTable = async () => {
    const head = [...WEEKDAY_LABELS, "합계"];
    const values = [...counts, lives.length];
    const cell = "border:1px solid #000;padding:4px 8px;text-align:center";
    const html = `<table style="border-collapse:collapse"><tr>${head
      .map((label) => `<th style="${cell}">${label}</th>`)
      .join("")}</tr><tr>${values.map((value) => `<td style="${cell}">${value}</td>`).join("")}</tr></table>`;
    const plain = `${head.join("\t")}\n${values.join("\t")}`;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
      setNotice("표를 복사했습니다.");
    } catch {
      setNotice("표를 복사하지 못했습니다.");
    }
  };

  const downloadImage = () => {
    canvasRef.current?.toBlob(
      (blob) => {
        if (!blob) {
          setNotice("이미지를 저장하지 못했습니다.");
          return;
        }
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `모바일라이브_${weekStart}_${weekEnd}.jpg`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      },
      "image/jpeg",
      0.9,
    );
  };

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <strong style={{ fontSize: 24 }}>모바일 라이브 주간업무보고서</strong>
          <div className="status note">
            라이브 목록에서 빨강으로 체크한 건만 문구와 이미지에 들어갑니다. 횟수는 참여 체크(노랑+빨강) 전체 기준입니다.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="button"
              className="btn"
              onClick={() => setWeekStart((current) => addDaysToDateKey(current, -7))}
              aria-label="이전 주"
            >
              ◀
            </button>
            <input
              type="date"
              className="field-input"
              value={weekStart}
              onChange={(event) => {
                if (isDateKey(event.target.value)) setWeekStart(getWeekStartDateKey(event.target.value));
              }}
              aria-label="주 선택"
              style={{ width: "auto", minWidth: 160 }}
            />
            <button
              type="button"
              className="btn"
              onClick={() => setWeekStart((current) => addDaysToDateKey(current, 7))}
              aria-label="다음 주"
            >
              ▶
            </button>
            <button type="button" className="btn" onClick={() => setWeekStart(getWeekStartDateKey(getKstDateKey()))}>
              이번 주
            </button>
            <span className="chip">
              {getShortDate(weekStart)}(월) ~ {getShortDate(weekEnd)}(일)
            </span>
          </div>
        </div>
      </article>

      {message ? <div className="status note">{message}</div> : null}
      {notice ? <div className="status note">{notice}</div> : null}

      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <div className="chip">요일별 횟수</div>
            <button type="button" className="btn" disabled={loading} onClick={() => void copyTable()}>
              표 복사
            </button>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="table-like" style={{ minWidth: 420 }}>
              <thead>
                <tr>
                  {WEEKDAY_LABELS.map((label) => (
                    <th key={label} style={{ textAlign: "center" }}>
                      {label}
                    </th>
                  ))}
                  <th style={{ textAlign: "center" }}>합계</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  {counts.map((count, index) => (
                    <td key={WEEKDAY_LABELS[index]} style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                      {count}
                    </td>
                  ))}
                  <td style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                    <strong>{lives.length}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </article>

      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <div className="chip">보고서 문구</div>
            <span className="muted">보고서 포함 {reportLives.length}건 · 수정 후 복사할 수 있습니다.</span>
            <button type="button" className="btn" disabled={loading || !text} onClick={() => void copyText()}>
              텍스트 복사
            </button>
            <button
              type="button"
              className="btn"
              disabled={loading}
              onClick={() => setText(buildReportText(weekStart, lives, counts))}
            >
              원래 문구로
            </button>
          </div>
          <textarea
            className="field-input"
            value={loading ? "불러오는 중입니다." : text}
            onChange={(event) => setText(event.target.value)}
            readOnly={loading}
            rows={Math.min(Math.max(reportLives.length + 2, 4), 24)}
            style={{ width: "100%", height: "auto", lineHeight: 1.6, fontFamily: "inherit", resize: "vertical" }}
          />
        </div>
      </article>

      <article className="panel">
        <div className="panel-pad" style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <div className="chip">이미지</div>
            <button type="button" className="btn" disabled={!imageReady} onClick={downloadImage}>
              JPG 저장
            </button>
          </div>
          {reportLives.length === 0 ? (
            <div className="status note">
              {loading ? "불러오는 중입니다." : "이 주에 보고서 포함(빨강)으로 체크한 라이브가 없습니다."}
            </div>
          ) : null}
          <canvas
            ref={canvasRef}
            style={{
              display: reportLives.length > 0 ? "block" : "none",
              width: "100%",
              height: "auto",
              borderRadius: 8,
            }}
          />
        </div>
      </article>
    </section>
  );
}
