"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchTodayPublishedElection } from "@/lib/election/storage";
import type { ElectionEvent } from "@/lib/election/types";
import styles from "./Election.module.css";

export function HomeElectionCard() {
  const [event, setEvent] = useState<ElectionEvent | null>(null);

  useEffect(() => {
    let mounted = true;
    void fetchTodayPublishedElection()
      .then((nextEvent) => {
        if (mounted) setEvent(nextEvent);
      })
      .catch((error) => {
        console.warn("오늘 선거 중계표를 불러오지 못했습니다.", error);
        if (mounted) setEvent(null);
      });

    return () => {
      mounted = false;
    };
  }, []);

  if (!event) return null;

  const previewPoints = event.points.slice(0, 3);

  return (
    <article className="panel" style={{ marginTop: 16 }}>
      <div className={`panel-pad ${styles.emptyPanel}`}>
        <div className={styles.toolbar}>
          <div>
            <span className={styles.statusBadge}>선거</span>
            <h2 style={{ margin: "10px 0 4px" }}>{event.title}</h2>
            <div className={styles.summary}>{event.electionDate} 중계 포인트 {event.points.length}개</div>
          </div>
          <Link className="btn primary" href="/election">
            선거 중계표 보기
          </Link>
        </div>
        {previewPoints.length > 0 ? (
          <div className={styles.tableWrap}>
            <table className="table-like" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th>장소</th>
                  <th>장비</th>
                  <th>촬영기자</th>
                </tr>
              </thead>
              <tbody>
                {previewPoints.map((point) => (
                  <tr key={point.id}>
                    <td>{point.place || "-"}</td>
                    <td>{point.equipmentName || "-"}</td>
                    <td>{point.cameraStaffName || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </article>
  );
}
