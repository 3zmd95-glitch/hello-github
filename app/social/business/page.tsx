import type { Metadata } from "next";
import BusinessScreen from "@/components/social/business/BusinessScreen";

export const metadata: Metadata = { title: "البزنس · 3z Prod" };

export default function BusinessPage() {
  return <BusinessScreen />;
}
