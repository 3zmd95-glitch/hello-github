import type { Metadata } from "next";
import CalendarScreen from "@/components/social/CalendarScreen";

export const metadata: Metadata = { title: "تقويم المحتوى · 3z Prod" };

export default function CalendarPage() {
  return <CalendarScreen />;
}
