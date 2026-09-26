import type { Metadata } from "next";
import SettingsScreen from "@/components/settings/SettingsScreen";

export const metadata: Metadata = { title: "الإعدادات · 3z Prod" };

export default function SettingsPage() {
  return <SettingsScreen />;
}
