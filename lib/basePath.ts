/**
 * Base path the app is served under (e.g. "/hello-github" on GitHub Pages, "" locally).
 * Use it for public asset URLs that Next.js does not rewrite for you (sw.js, icons, manifest links).
 */
export function basePath(): string {
  return process.env.NEXT_PUBLIC_BASE_PATH ?? "";
}

/** Prefix a public path ("/sw.js") with the base path. */
export function withBasePath(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${basePath()}${p}`;
}
