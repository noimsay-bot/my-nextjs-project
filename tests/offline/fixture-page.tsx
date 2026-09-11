"use client";

import { ShinyText } from "@/components/effects/ShinyText";
import { LiveEquipmentStatusHomePanel } from "@/components/equipment/live-equipment-status-home-panel";

export default function OfflineComponentLab() {
  return (
    <main style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>
      <h1>Offline component lab</h1>
      <div data-testid="shine-moving"><ShinyText text="Shine moving" speed={0.5} delay={0.1} yoyo pauseOnHover /></div>
      <div data-testid="shine-paused"><ShinyText text="Shine paused" disabled direction="right" /></div>
      <LiveEquipmentStatusHomePanel />
    </main>
  );
}
