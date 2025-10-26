import { app } from "./agent";

const port = Number(process.env.PORT ?? 8787);

const server = Bun.serve({
  port,
  hostname: "0.0.0.0",
  fetch: app.fetch,
});

const displayHost = server.hostname === "0.0.0.0" ? "localhost" : server.hostname;

console.log(
  `🚀 Agent ready at http://${displayHost}:${server.port}/.well-known/agent.json`
);
