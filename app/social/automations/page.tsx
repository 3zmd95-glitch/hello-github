import type { Metadata } from "next";
import SoonScreen from "@/components/social/SoonScreen";

export const metadata: Metadata = { title: "الأتمتة · 3z Prod" };

export default function AutomationsPage() {
  return <SoonScreen kind="automations" />;
}
