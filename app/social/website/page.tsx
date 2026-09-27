import type { Metadata } from "next";
import SoonScreen from "@/components/social/SoonScreen";

export const metadata: Metadata = { title: "الموقع · 3z Prod" };

export default function WebsitePage() {
  return <SoonScreen kind="website" />;
}
