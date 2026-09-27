import type { Metadata } from "next";
import MapScreen from "@/components/map/MapScreen";

export const metadata: Metadata = { title: "الخريطة · 3z Prod" };

export default function MapPage() {
  return <MapScreen />;
}
