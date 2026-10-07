"use client";

import type { ComponentProps } from "react";
import Sheet from "@/components/ui/ios/Sheet";

/**
 * The calendar's sheets on the iOS Sheet. The post popup (`wide`) opens at medium with large a drag away, and is the
 * wider dialog on desktop; the forms open at one large detent, the height a keyboard needs.
 */
export default function SheetFrame(
  props: Omit<ComponentProps<typeof Sheet>, "detents" | "initialDetent">,
) {
  return <Sheet {...props} detents={props.wide ? [0.6, 0.92] : [0.92]} />;
}
