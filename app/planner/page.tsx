import type { Metadata } from "next";
import PlannerScreen from "@/components/planner/PlannerScreen";

export const metadata: Metadata = { title: "المخطط · 3z Prod" };

export default function PlannerPage() {
  return <PlannerScreen />;
}
