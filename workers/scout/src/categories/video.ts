/** Standalone metadata contract shared with client-side ranking; no Worker environment types. */
export interface TopVideo {
  url: string;
  title: string;
  creator?: string;
  views?: number;
  publishedAt?: string;
  thumbnail?: string;
  age?: string;
  snippet?: string;
  source?: "tavily" | "youtube" | "tiktok-discovery";
  evidence?: { basis: "metadata"; subjects: string[]; techniques: string[] };
}
