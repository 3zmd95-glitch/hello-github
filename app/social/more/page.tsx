import type { Metadata } from "next";
import MoreScreen from "@/components/shell/MoreScreen";

export const metadata: Metadata = { title: "المزيد · 3z Prod" };

export default function SocialMorePage() {
  return <MoreScreen world="social" />;
}
