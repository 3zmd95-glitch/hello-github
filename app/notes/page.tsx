import type { Metadata } from "next";
import NotesScreen from "@/components/notes/NotesScreen";

export const metadata: Metadata = { title: "النوتات · 3z Prod" };

export default function NotesPage() {
  return <NotesScreen />;
}
