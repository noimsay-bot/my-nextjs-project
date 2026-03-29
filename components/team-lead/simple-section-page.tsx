"use client";

export function SimpleSectionPage({ title, description }: { title: string; description: string }) {
  return (
    <section className="panel">
      <div className="panel-pad" style={{ display: "grid", gap: 14 }}>
        <div className="chip">{title}</div>
        <strong style={{ fontSize: 24 }}>{title}</strong>
        <div className="status note">{description}</div>
      </div>
    </section>
  );
}
