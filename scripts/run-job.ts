/**
 * Runs a background job once from the command line: `npm run job:rig-health`.
 * The same idempotent functions back POST /api/cron/<job>.
 */
import { pool } from "@/db";
import { JOBS, isJobName } from "@/jobs";

async function main() {
  const name = process.argv[2] ?? "";
  if (!isJobName(name)) {
    console.error(`Unknown job "${name}". Available: ${Object.keys(JOBS).join(", ")}`);
    process.exitCode = 2;
    return;
  }
  const started = Date.now();
  const result = await JOBS[name]();
  console.log(JSON.stringify({ job: name, ms: Date.now() - started, result }));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
