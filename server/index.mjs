import { rmSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "./app.mjs";
const port = Number(process.env.PORT || 4318);
const host = process.env.HOST || "127.0.0.1";
let app;
let restarting = false;
async function restart() {
  if (restarting) return;
  restarting = true;
  console.log("Restarting Opportunity Knox…");
  const dataDir = process.env.BOARD_DATA_DIR;
  // The host watcher recreates the container after applying pending mounts.
  // Exiting here would restart the old container before the mount is ready.
  if (dataDir === "/data") { restarting = false; return; }
  await app.close();
  if (dataDir) rmSync(join(dataDir, "pending-restart.json"), { force: true });
  app = createApp({ onRestart: restart });
  await new Promise((done) => app.server.listen(port, host, done));
  restarting = false;
  console.log(`Opportunity Knox restarted on http://${host}:${port}`);
}
app = createApp({ onRestart: restart });
app.server.listen(port, host, () =>
  console.log(`Opportunity Knox listening on http://${host}:${port}`),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
