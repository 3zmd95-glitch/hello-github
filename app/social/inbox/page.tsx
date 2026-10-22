import type { Metadata } from "next";
import InboxScreen from "@/components/social/inbox/InboxScreen";

export const metadata: Metadata = { title: "الرسائل · 3z Prod" };

export default function InboxPage() {
  return <InboxScreen />;
}
