import { DurableObject } from "cloudflare:workers";
import {
  InboxDb,
  type IngestBatch,
  type InboxApi,
  type InboxPlatform,
  type SendRow,
  type Sql,
} from "./inboxDb";

/** The owner's inbox store (planning/tools/51-global-inbox.md): one object, idFromName("owner"). Thin: every method is InboxDb's. */
export class InboxStore extends DurableObject<unknown> implements InboxApi {
  private readonly db: InboxDb;
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    const sql: Sql = {
      all: (q, ...b) => ctx.storage.sql.exec(q, ...b).toArray() as never,
      run: (ddl) => void ctx.storage.sql.exec(ddl),
    };
    this.db = new InboxDb(sql);
  }
  ingest(b: IngestBatch) {
    return this.db.ingest(b);
  }
  overview() {
    return this.db.overview();
  }
  conversations(q: Parameters<InboxApi["conversations"]>[0]) {
    return this.db.conversations(q);
  }
  thread(p: InboxPlatform, id: string, q: Parameters<InboxApi["thread"]>[2]) {
    return this.db.thread(p, id, q);
  }
  posts(q: Parameters<InboxApi["posts"]>[0]) {
    return this.db.posts(q);
  }
  comments(p: InboxPlatform, id: string, q: Parameters<InboxApi["comments"]>[2]) {
    return this.db.comments(p, id, q);
  }
  comment(p: InboxPlatform, id: string) {
    return this.db.comment(p, id);
  }
  recordSend(r: SendRow) {
    return this.db.recordSend(r);
  }
  setHidden(p: InboxPlatform, id: string, hidden: boolean) {
    return this.db.setHidden(p, id, hidden);
  }
  deleteComment(p: InboxPlatform, id: string) {
    return this.db.deleteComment(p, id);
  }
  retain(nowIso: string) {
    return this.db.retain(nowIso);
  }
  wipe() {
    return this.db.wipe();
  }
  getMeta(k: string) {
    return this.db.getMeta(k);
  }
  setMeta(k: string, v: string) {
    return this.db.setMeta(k, v);
  }
}

/** The store's RPC stub, or null when the binding is missing (an older deploy, a test env). */
export function inboxApi(env: {
  INBOX_STORE?: DurableObjectNamespace<InboxStore>;
}): InboxApi | null {
  if (!env.INBOX_STORE) return null;
  return env.INBOX_STORE.get(env.INBOX_STORE.idFromName("owner")) as unknown as InboxApi;
}
