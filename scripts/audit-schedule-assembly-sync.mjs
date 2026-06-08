#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ALLOWED_ASSEMBLY_SYNC_KEYS = new Set(["국회", "휴가", "제크", "연차", "기타"]);
const PROTECTED_ASSIGNMENT_KEYS = [
  "조근",
  "일반",
  "연장",
  "석근",
  "야근",
  "청사",
  "청와대",
  "대휴",
  "오전",
  "데이",
  "오후",
  "저녁",
  "심야",
  "휴일",
  "현장",
  "주말조근",
  "주말일반근무",
  "뉴스대기",
];
const WATCH_KEYS = ["국회", "휴가", "제크", "연차", "기타", "대휴"];

function readArgs() {
  const args = new Map();
  process.argv.slice(2).forEach((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    args.set(key, rest.join("=") || "true");
  });
  return args;
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] ||= value;
  }
}

function normalizeNames(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function getAssignments(day) {
  return day?.assignments && typeof day.assignments === "object" ? day.assignments : {};
}

function sameNames(left, right) {
  return JSON.stringify(normalizeNames(left)) === JSON.stringify(normalizeNames(right));
}

function summarizeWatchAssignments(assignments) {
  return Object.fromEntries(WATCH_KEYS.map((key) => [key, normalizeNames(assignments[key])]));
}

function getDraftDayMap(schedule) {
  return new Map((schedule?.days ?? []).map((day) => [day.dateKey, day]));
}

function analyzeMonth(row) {
  const draftDayMap = getDraftDayMap(row.draft_state);
  const days = row.published_state?.days ?? [];
  const candidateDays = [];
  const assignmentKeyInventory = new Map();

  days.forEach((day) => {
    const assignments = getAssignments(day);
    const keys = Object.keys(assignments).sort((left, right) => left.localeCompare(right));
    keys.forEach((key) => assignmentKeyInventory.set(key, (assignmentKeyInventory.get(key) ?? 0) + 1));
    const emptyAssignmentKeys = keys.filter((key) => Array.isArray(assignments[key]) && assignments[key].length === 0);
    const draftAssignments = getAssignments(draftDayMap.get(day.dateKey));
    const protectedDifferences = PROTECTED_ASSIGNMENT_KEYS
      .filter((key) => !ALLOWED_ASSEMBLY_SYNC_KEYS.has(key))
      .filter((key) => !sameNames(draftAssignments[key], assignments[key]))
      .map((key) => ({
        key,
        draft: normalizeNames(draftAssignments[key]),
        published: normalizeNames(assignments[key]),
      }))
      .filter((item) => item.draft.length > 0 || item.published.length > 0);

    const hasWatchedState = WATCH_KEYS.some((key) => normalizeNames(assignments[key]).length > 0);
    if (protectedDifferences.length > 0 || emptyAssignmentKeys.length > 0 || hasWatchedState) {
      candidateDays.push({
        date: day.dateKey,
        assignmentKeys: keys,
        emptyAssignmentKeys,
        watch: summarizeWatchAssignments(assignments),
        protectedDifferences,
      });
    }
  });

  return {
    month_key: row.month_key,
    published_at: row.published_at,
    updated_at: row.updated_at,
    published_day_count: days.length,
    assignment_key_inventory: Object.fromEntries([...assignmentKeyInventory.entries()].sort()),
    candidate_days: candidateDays,
  };
}

async function maybeSelect(supabase, table, select, options = {}) {
  let query = supabase.from(table).select(select);
  if (options.order) {
    query = query.order(options.order.column, { ascending: options.order.ascending });
  }
  if (options.limit) {
    query = query.limit(options.limit);
  }
  const { data, error } = await query;
  if (error) {
    return { error: error.message, data: [] };
  }
  return { error: null, data: data ?? [] };
}

const args = readArgs();
loadEnv(path.join(process.cwd(), ".env.local"));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const monthFilter = args.get("month");
const recentLimit = Number(args.get("recent") ?? 50);
const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let monthQuery = supabase
  .from("schedule_months")
  .select("month_key,draft_state,published_state,published_at,updated_at")
  .not("published_state", "is", null)
  .order("month_key", { ascending: true });
if (monthFilter) {
  monthQuery = monthQuery.eq("month_key", monthFilter);
}
const { data: monthRows, error: monthError } = await monthQuery;
if (monthError) {
  throw new Error(monthError.message);
}

const syncLogs = await maybeSelect(
  supabase,
  "schedule_assembly_sync_logs",
  "created_at,trigger_type,target_month,total_source_count,inserted_count,updated_count,deleted_count,skipped_count,error_count,error_details",
  { order: { column: "created_at", ascending: false }, limit: Number.isFinite(recentLimit) ? recentLimit : 50 },
);
const leavePushLogs = await maybeSelect(
  supabase,
  "schedule_assembly_leave_push_logs",
  "created_at,action,date,member_name,request_id,success,error_message",
  { order: { column: "created_at", ascending: false }, limit: Number.isFinite(recentLimit) ? recentLimit : 50 },
);

const analyzedMonths = (monthRows ?? []).map(analyzeMonth);
const recentLogMonths = Array.from(new Set((syncLogs.data ?? []).map((item) => item.target_month).filter(Boolean)));

console.log(JSON.stringify({
  generated_at: new Date().toISOString(),
  read_only: true,
  month_filter: monthFilter ?? null,
  recent_log_months: recentLogMonths,
  months: analyzedMonths,
  recent_sync_logs: syncLogs,
  recent_leave_push_logs: leavePushLogs,
}, null, 2));
