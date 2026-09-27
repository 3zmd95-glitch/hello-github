import type { Metadata } from "next";
import SoonScreen from "@/components/social/SoonScreen";

export const metadata: Metadata = { title: "البزنس · 3z Prod" };

export default function BusinessPage() {
  return <SoonScreen kind="business" />;
}
