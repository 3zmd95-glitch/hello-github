// The global inbox's SQLite layer (planning/tools/51-global-inbox.md). Runs inside the InboxStore Durable Object
// (inboxStore.ts) and, in tests, on node:sqlite through the `Sql` interface.

export const RETAIN_CONVERSATIONS = 200;
export const RETAIN_POSTS = 50;
export const RETAIN_DAYS = 30;
export const PAGE = 20;

export type InboxPlatform = "instagram" | "tiktok";
export interface ConversationRow {
  platform: InboxPlatform;
  id: string;
  peerId: string;
  peerName: string;
  updatedAt: string;
  lastText: string;
  lastFrom: "peer" | "owner" | "auto";
  windowClosesAt: string | null;
  answeredBy: "auto" | null;
}
export interface MessageRow {
  platform: InboxPlatform;
  convId: string;
  id: string;
  at: string;
  fromPeer: boolean;
  text: string;
  kind: "text" | "story" | "share" | "unsupported";
  sentBy: "peer" | "owner" | "auto";
}
export interface PostRow {
  platform: InboxPlatform;
  id: string;
  permalink: string;
  thumbUrl: string | null;
  caption: string;
  postedAt: string;
  commentCount: number;
}
export interface CommentRow {
  platform: InboxPlatform;
  postId: string;
  id: string;
  parentId: string | null;
  at: string;
  author: string;
  authorId: string | null;
  text: string;
  hidden: boolean;
  ours: boolean;
  sentBy: "owner" | "auto" | null;
}
export interface SendRow {
  platform: InboxPlatform;
  kind: "dm" | "reply" | "private";
  targetId: string;
  text: string;
  at: string;
  state: "sent" | "unconfirmed" | "refused";
  platformId: string | null;
  detail: string | null;
}
export interface IngestBatch {
  conversations?: ConversationRow[];
  messages?: MessageRow[];
  posts?: PostRow[];
  comments?: CommentRow[];
  readAt?: { platform: InboxPlatform; at: string };
}
export interface Overview {
  platforms: Record<InboxPlatform, { lastReadAt: string | null; newestAt: string | null }>;
  counts: { conversations: number; posts: number; comments: number };
}
export interface Page<T> {
  items: T[];
  more: boolean;
}
/** The two SQL calls the layer needs: `all` runs any statement with binds, `run` executes the schema script. */
export interface Sql {
  all<T = Record<string, unknown>>(query: string, ...binds: (string | number | null)[]): T[];
  run(ddl: string): void;
}
export interface InboxApi {
  ingest(batch: IngestBatch): Promise<void>;
  overview(): Promise<Overview>;
  conversations(q: {
    platform?: InboxPlatform;
    before?: string;
    limit?: number;
  }): Promise<Page<ConversationRow>>;
  thread(
    platform: InboxPlatform,
    id: string,
    q: { before?: string; limit?: number },
  ): Promise<{ conversation: ConversationRow; messages: Page<MessageRow> } | null>;
  posts(q: { platform?: InboxPlatform; before?: string; limit?: number }): Promise<Page<PostRow>>;
  comments(
    platform: InboxPlatform,
    postId: string,
    q: { before?: string; limit?: number },
  ): Promise<{ post: PostRow; comments: Page<CommentRow> } | null>;
  recordSend(row: SendRow): Promise<void>;
  setHidden(platform: InboxPlatform, commentId: string, hidden: boolean): Promise<void>;
  deleteComment(platform: InboxPlatform, commentId: string): Promise<void>;
  retain(nowIso: string): Promise<{ dropped: number }>;
  wipe(): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
}

const DDL = `
CREATE TABLE IF NOT EXISTS conversations (platform TEXT, id TEXT, peerId TEXT, peerName TEXT, updatedAt TEXT, lastText TEXT,
  lastFrom TEXT, windowClosesAt TEXT, answeredBy TEXT, PRIMARY KEY (platform, id));
CREATE INDEX IF NOT EXISTS conversations_updated ON conversations (updatedAt DESC);
CREATE TABLE IF NOT EXISTS messages (platform TEXT, convId TEXT, id TEXT, at TEXT, fromPeer INTEGER, text TEXT, kind TEXT, sentBy TEXT,
  PRIMARY KEY (platform, id));
CREATE INDEX IF NOT EXISTS messages_conv ON messages (platform, convId, at);
CREATE TABLE IF NOT EXISTS posts (platform TEXT, id TEXT, permalink TEXT, thumbUrl TEXT, caption TEXT, postedAt TEXT, commentCount INTEGER,
  PRIMARY KEY (platform, id));
CREATE TABLE IF NOT EXISTS comments (platform TEXT, postId TEXT, id TEXT, parentId TEXT, at TEXT, author TEXT, authorId TEXT, text TEXT,
  hidden INTEGER, ours INTEGER, sentBy TEXT, PRIMARY KEY (platform, id));
CREATE INDEX IF NOT EXISTS comments_post ON comments (platform, postId, at DESC);
CREATE TABLE IF NOT EXISTS sends (seq INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT, kind TEXT, targetId TEXT, text TEXT, at TEXT,
  state TEXT, platformId TEXT, detail TEXT);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);`;

const bool = (v: unknown) => v === 1 || v === true;

export class InboxDb implements InboxApi {
  constructor(private readonly sql: Sql) {
    sql.run(DDL);
  }

  async ingest(b: IngestBatch): Promise<void> {
    for (const c of b.conversations ?? [])
      this.sql.all(
        `INSERT INTO conversations VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(platform,id) DO UPDATE SET peerName=excluded.peerName,
        updatedAt=excluded.updatedAt, lastText=excluded.lastText, lastFrom=excluded.lastFrom, windowClosesAt=excluded.windowClosesAt,
        answeredBy=COALESCE(excluded.answeredBy, conversations.answeredBy)`,
        c.platform,
        c.id,
        c.peerId,
        c.peerName,
        c.updatedAt,
        c.lastText,
        c.lastFrom,
        c.windowClosesAt,
        c.answeredBy,
      );
    for (const m of b.messages ?? [])
      this.sql.all(
        `INSERT OR REPLACE INTO messages VALUES (?,?,?,?,?,?,?,?)`,
        m.platform,
        m.convId,
        m.id,
        m.at,
        m.fromPeer ? 1 : 0,
        m.text,
        m.kind,
        m.sentBy,
      );
    for (const p of b.posts ?? [])
      this.sql.all(
        `INSERT OR REPLACE INTO posts VALUES (?,?,?,?,?,?,?)`,
        p.platform,
        p.id,
        p.permalink,
        p.thumbUrl,
        p.caption,
        p.postedAt,
        p.commentCount,
      );
    for (const c of b.comments ?? [])
      this.sql.all(
        `INSERT INTO comments VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(platform,id) DO UPDATE SET text=excluded.text,
        hidden=excluded.hidden, author=excluded.author, sentBy=COALESCE(excluded.sentBy, comments.sentBy)`,
        c.platform,
        c.postId,
        c.id,
        c.parentId,
        c.at,
        c.author,
        c.authorId,
        c.text,
        c.hidden ? 1 : 0,
        c.ours ? 1 : 0,
        c.sentBy,
      );
    if (b.readAt) await this.setMeta(`lastReadAt:${b.readAt.platform}`, b.readAt.at);
  }

  async overview(): Promise<Overview> {
    const count = (t: string) =>
      Number(this.sql.all<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)[0]?.n ?? 0);
    const platform = async (p: InboxPlatform) => ({
      lastReadAt: await this.getMeta(`lastReadAt:${p}`),
      newestAt:
        this.sql.all<{ t: string | null }>(
          `SELECT MAX(updatedAt) AS t FROM conversations WHERE platform=?`,
          p,
        )[0]?.t ?? null,
    });
    return {
      platforms: { instagram: await platform("instagram"), tiktok: await platform("tiktok") },
      counts: {
        conversations: count("conversations"),
        posts: count("posts"),
        comments: count("comments"),
      },
    };
  }

  private page<T>(rows: T[], limit: number): Page<T> {
    return rows.length > limit
      ? { items: rows.slice(0, limit), more: true }
      : { items: rows, more: false };
  }

  async conversations(q: {
    platform?: InboxPlatform;
    before?: string;
    limit?: number;
  }): Promise<Page<ConversationRow>> {
    const limit = q.limit ?? PAGE;
    const rows = this.sql.all<ConversationRow>(
      `SELECT * FROM conversations WHERE (? IS NULL OR platform=?) AND (? IS NULL OR updatedAt<?) ORDER BY updatedAt DESC LIMIT ?`,
      q.platform ?? null,
      q.platform ?? null,
      q.before ?? null,
      q.before ?? null,
      limit + 1,
    );
    return this.page(rows, limit);
  }

  async thread(platform: InboxPlatform, id: string, q: { before?: string; limit?: number }) {
    const conversation = this.sql.all<ConversationRow>(
      `SELECT * FROM conversations WHERE platform=? AND id=?`,
      platform,
      id,
    )[0];
    if (!conversation) return null;
    const limit = q.limit ?? PAGE;
    const rows = this.sql.all<Omit<MessageRow, "fromPeer"> & { fromPeer: number }>(
      `SELECT * FROM messages WHERE platform=? AND convId=? AND (? IS NULL OR at<?) ORDER BY at DESC LIMIT ?`,
      platform,
      id,
      q.before ?? null,
      q.before ?? null,
      limit + 1,
    );
    const page = this.page(rows, limit);
    return {
      conversation,
      messages: {
        more: page.more,
        items: page.items.reverse().map((m) => ({ ...m, fromPeer: bool(m.fromPeer) })),
      },
    };
  }

  async posts(q: {
    platform?: InboxPlatform;
    before?: string;
    limit?: number;
  }): Promise<Page<PostRow>> {
    const limit = q.limit ?? PAGE;
    return this.page(
      this.sql.all<PostRow>(
        `SELECT * FROM posts WHERE (? IS NULL OR platform=?) AND (? IS NULL OR postedAt<?) ORDER BY postedAt DESC LIMIT ?`,
        q.platform ?? null,
        q.platform ?? null,
        q.before ?? null,
        q.before ?? null,
        limit + 1,
      ),
      limit,
    );
  }

  async comments(platform: InboxPlatform, postId: string, q: { before?: string; limit?: number }) {
    const post = this.sql.all<PostRow>(
      `SELECT * FROM posts WHERE platform=? AND id=?`,
      platform,
      postId,
    )[0];
    if (!post) return null;
    const limit = q.limit ?? PAGE;
    const rows = this.sql.all<
      Omit<CommentRow, "hidden" | "ours"> & { hidden: number; ours: number }
    >(
      `SELECT * FROM comments WHERE platform=? AND postId=? AND (? IS NULL OR at<?) ORDER BY at DESC LIMIT ?`,
      platform,
      postId,
      q.before ?? null,
      q.before ?? null,
      limit + 1,
    );
    const page = this.page(rows, limit);
    return {
      post,
      comments: {
        more: page.more,
        items: page.items.map((c) => ({ ...c, hidden: bool(c.hidden), ours: bool(c.ours) })),
      },
    };
  }

  async recordSend(r: SendRow): Promise<void> {
    this.sql.all(
      `INSERT INTO sends (platform,kind,targetId,text,at,state,platformId,detail) VALUES (?,?,?,?,?,?,?,?)`,
      r.platform,
      r.kind,
      r.targetId,
      r.text,
      r.at,
      r.state,
      r.platformId,
      r.detail,
    );
  }
  async setHidden(platform: InboxPlatform, id: string, hidden: boolean) {
    this.sql.all(
      `UPDATE comments SET hidden=? WHERE platform=? AND id=?`,
      hidden ? 1 : 0,
      platform,
      id,
    );
  }
  async deleteComment(platform: InboxPlatform, id: string) {
    this.sql.all(`DELETE FROM comments WHERE platform=? AND id=?`, platform, id);
  }

  async retain(nowIso: string): Promise<{ dropped: number }> {
    const cutoff = new Date(new Date(nowIso).getTime() - RETAIN_DAYS * 86_400_000).toISOString();
    const before = (await this.overview()).counts;
    this.sql.all(
      `DELETE FROM conversations WHERE updatedAt<? OR (platform, id) NOT IN (SELECT platform, id FROM conversations ORDER BY updatedAt DESC LIMIT ?)`,
      cutoff,
      RETAIN_CONVERSATIONS,
    );
    this.sql.all(
      `DELETE FROM messages WHERE NOT EXISTS (SELECT 1 FROM conversations c WHERE c.platform=messages.platform AND c.id=messages.convId)`,
    );
    this.sql.all(
      `DELETE FROM posts WHERE postedAt<? OR (platform, id) NOT IN (SELECT platform, id FROM posts ORDER BY postedAt DESC LIMIT ?)`,
      cutoff,
      RETAIN_POSTS,
    );
    this.sql.all(
      `DELETE FROM comments WHERE NOT EXISTS (SELECT 1 FROM posts p WHERE p.platform=comments.platform AND p.id=comments.postId)`,
    );
    this.sql.all(`DELETE FROM sends WHERE at<?`, cutoff);
    const after = (await this.overview()).counts;
    return {
      dropped:
        before.conversations +
        before.posts +
        before.comments -
        after.conversations -
        after.posts -
        after.comments,
    };
  }
  async wipe() {
    for (const t of ["conversations", "messages", "posts", "comments", "sends", "meta"])
      this.sql.all(`DELETE FROM ${t}`);
  }
  async getMeta(key: string) {
    return (
      this.sql.all<{ value: string }>(`SELECT value FROM meta WHERE key=?`, key)[0]?.value ?? null
    );
  }
  async setMeta(key: string, value: string) {
    this.sql.all(`INSERT OR REPLACE INTO meta VALUES (?,?)`, key, value);
  }
}
