import { startApi } from "./api.js";
import { startWorker } from "./worker.js";

const server = await startApi();
const stopWorker = startWorker();
let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await stopWorker();
  await server.close();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
