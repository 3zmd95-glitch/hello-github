import { startLocalAiServer } from "./server";

void startLocalAiServer()
  .then((server) => {
    console.log(
      "3z Prod is ready at http://localhost:3000/ (local AI connections stay on this computer).",
    );
    const stop = () => {
      server.close();
      server.closeAllConnections();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  })
  .catch((error: unknown) => {
    const code = (error as NodeJS.ErrnoException)?.code;
    console.error(
      code === "EADDRINUSE"
        ? "Port 3000 is already in use. Stop the existing local server before starting 3z Prod."
        : code === "ENOENT"
          ? "Build the site first with pnpm build."
          : "Could not start the local server.",
    );
    process.exitCode = 1;
  });
