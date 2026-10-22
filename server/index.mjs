import { createApp } from "./app.mjs";
const app = createApp();
const port = Number(process.env.PORT || 4318);
const host = process.env.HOST || "127.0.0.1";
app.server.listen(port, host, () =>
  console.log(`Opportunity Knox listening on http://${host}:${port}`),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
