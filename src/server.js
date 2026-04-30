import { createRuntime } from "./bootstrap.js";

const { app, config, services, shutdown } = createRuntime(process.env);

const server = app.listen(config.port, () => {
  console.log(`Z7 RSS listening on http://0.0.0.0:${config.port}`);
});
services.refreshService.startSchedule();
services.digestService.startSchedule();
if (services.maintenanceService.startSchedule()) {
  services.maintenanceService.triggerRun({ trigger: "startup" });
}

let isShuttingDown = false;

async function handleShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`Received ${signal}, shutting down gracefully...`);

  try {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    await shutdown();
    process.exit(0);
  } catch (error) {
    console.error("Graceful shutdown failed:", error?.message || error);
    process.exit(1);
  }
}

process.on("SIGINT", () => {
  void handleShutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void handleShutdown("SIGTERM");
});
