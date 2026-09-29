import type { Metadata } from "next";
import AutoRepliesScreen from "@/components/social/AutoRepliesScreen";

export const metadata: Metadata = { title: "الردود التلقائية · 3z Prod" };

export default function RepliesPage() {
  return <AutoRepliesScreen />;
}
