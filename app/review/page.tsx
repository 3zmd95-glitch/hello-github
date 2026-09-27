import type { Metadata } from "next";
import ReviewScreen from "@/components/review/ReviewScreen";

export const metadata: Metadata = { title: "المراجعة · 3z Prod" };

export default function ReviewPage() {
  return <ReviewScreen />;
}
