import { app, AGENT_NAMESPACE } from "./agent";

const port = Number(process.env.PORT ?? 8787);

console.log(
  `[${AGENT_NAMESPACE}] Bootstrapping HTTP server (pid=${process.pid})`
);

if (!process.env.PORT) {
  console.warn(
    `[${AGENT_NAMESPACE}] PORT environment variable not set; defaulting to ${port}`
  );
}

const server = Bun.serve({
  port,
  hostname: "0.0.0.0",
  fetch: app.fetch,
});

console.log(
  `[${AGENT_NAMESPACE}] Bun server created (hostname=${server.hostname}, port=${server.port})`
);

const displayHost = server.hostname === "0.0.0.0" ? "localhost" : server.hostname;

console.log(
  `🚀 Agent ready at http://${displayHost}:${server.port}/.well-known/agent.json`
);

let shuttingDown = false;

const handleShutdown = (signal: NodeJS.Signals) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(
    `[${AGENT_NAMESPACE}] Received ${signal}. Attempting graceful shutdown...`
  );
  try {
    const result = server.stop();
    if (result instanceof Promise) {
      result
        .then(() => {
          console.log(
            `[${AGENT_NAMESPACE}] Server stopped gracefully after ${signal}.`
          );
        })
        .catch((error) => {
          console.error(
            `[${AGENT_NAMESPACE}] Error during graceful shutdown.`,
            error
          );
        })
        .finally(() => {
          process.exit(0);
        });
    } else {
      console.log(
        `[${AGENT_NAMESPACE}] Server stopped synchronously after ${signal}.`
      );
      process.exit(0);
    }
  } catch (error) {
    console.error(
      `[${AGENT_NAMESPACE}] Unexpected error while stopping server.`,
      error
    );
    process.exit(1);
  }
};

process.on("SIGTERM", () => handleShutdown("SIGTERM"));
process.on("SIGINT", () => handleShutdown("SIGINT"));

process.on("uncaughtException", (error) => {
  console.error(`[${AGENT_NAMESPACE}] Uncaught exception`, error);
});

process.on("unhandledRejection", (reason) => {
  console.error(`[${AGENT_NAMESPACE}] Unhandled rejection`, reason);
});
