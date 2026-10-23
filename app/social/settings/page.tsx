import type { Metadata } from "next";
import SocialSettingsScreen from "@/components/settings/SocialSettingsScreen";

export const metadata: Metadata = { title: "الإعدادات · 3z Prod" };

export default function SocialSettingsPage() {
  return <SocialSettingsScreen />;
}
