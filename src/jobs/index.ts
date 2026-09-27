import "server-only";
import { runRigHealth } from "./rig-health";

/** Registry of background jobs exposed via POST /api/cron/<name> and `npm run job:<name>`. */
export const JOBS = {
  "rig-health": () => runRigHealth(),
} as const;

export type JobName = keyof typeof JOBS;

export function isJobName(name: string): name is JobName {
  return Object.hasOwn(JOBS, name);
}
