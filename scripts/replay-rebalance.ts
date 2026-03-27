import fs from "fs";
import path from "path";
import { autoRebalance, sanitizeScheduleState } from "@/lib/schedule/engine";

function readJson(filePath: string) {
  const absolutePath = path.resolve(filePath);
  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

function summarizeDay(generated: any, dateKey: string) {
  const day = generated.days.find((item: any) => item.dateKey === dateKey);
  if (!day) {
    return { dateKey, found: false };
  }

  return {
    dateKey,
    found: true,
    assignments: day.assignments,
    conflicts: (day.conflicts ?? []).map((item: { category: string; name: string }) => `${item.category}:${item.name}`),
  };
}

const [, , inputPath, monthKey = "2026-05"] = process.argv;

if (!inputPath) {
  console.error("Usage: node -r ts-node/register/transpile-only -r tsconfig-paths/register scripts/replay-rebalance.ts <state-json-path> [monthKey]");
  process.exit(1);
}

const raw = readJson(inputPath);
const state = sanitizeScheduleState(raw);
const result = autoRebalance(state);
const generated =
  result.state.generatedHistory.find((item) => item.monthKey === monthKey) ??
  result.state.generated;

if (!generated) {
  console.error(`No generated schedule found for ${monthKey}`);
  process.exit(1);
}

const focusDates = ["2026-05-09", "2026-05-15", "2026-05-16", "2026-05-24", "2026-05-30", "2026-05-31"];

console.log(result.message);
for (const dateKey of focusDates) {
  console.log(JSON.stringify(summarizeDay(generated, dateKey), null, 2));
}
