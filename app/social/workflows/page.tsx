import type { Metadata } from "next";
import WorkflowsScreen from "@/components/social/workflows/WorkflowsScreen";

export const metadata: Metadata = { title: "الخطوات التلقائية · 3z Prod" };

export default function WorkflowsPage() {
  return <WorkflowsScreen />;
}
