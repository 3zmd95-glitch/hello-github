// Static server for `pnpm e2e` (see playwright.config.ts). It serves the `out/` export exactly the way
// `npx serve out` does (serve's own `serve-handler`: `/route/` -> `out/route/index.html`, unknown paths ->
// `out/404.html` with status 404) minus serve's file-handle leak: serve-handler pipes a file into the
// response and forgets it, so when the browser drops a request (navigating away mid-load, closing the page)
// the paused read stream keeps its file open for good. A Node process on Windows may hold about 2,000
// files, which the full suite (8 workers, both projects) reached after ~380 tests: `EMFILE: too many open files`.
// Here every stream is destroyed as soon as its response closes.
// Run: pnpm exec tsx scripts/e2e-server.ts <port>
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import handler from "serve-handler";

const port = Number(process.argv[2]) || 3000;

createServer((req, res) => {
  const read: typeof createReadStream = (file, options) => {
    const stream = createReadStream(file, options);
    res.once("close", () => stream.destroy());
    return stream;
  };
  handler(req, res, { public: "out" }, { createReadStream: read }).catch((error: unknown) => {
    console.error(error);
    res.destroy();
  });
}).listen(port, () => console.log(`e2e server: http://localhost:${port}/ serves out/`));
