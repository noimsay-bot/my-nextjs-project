export type PortfolioCaptureTarget = {
  name: string;
  path: string;
  waitFor?: string;
  fullPage?: boolean;
};

export const portfolioCaptureOutputDir = "portfolio-captures";

export const portfolioMaskSelectors = [
  ".staff-name",
  ".employee-id",
  ".phone",
  ".email",
  ".score",
  ".evaluation-value",
];

export const portfolioCaptureTargets: PortfolioCaptureTarget[] = [
  // Replace these sample routes with the exact screens you want to capture.
  { name: "schedule", path: "/schedule", fullPage: true },
  { name: "schedule-assignment", path: "/schedule/schedule-assignment", fullPage: true },
];
