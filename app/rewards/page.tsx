import type { Metadata } from "next";
import RewardsScreen from "@/components/rewards/RewardsScreen";

export const metadata: Metadata = { title: "المكافآت · 3z Prod" };

export default function RewardsPage() {
  return <RewardsScreen />;
}
