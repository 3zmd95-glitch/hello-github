/** Square pixel tile with an emoji icon on a tinted background (same look as the Skills screen tiles). */
export function TileIcon({
  icon,
  color,
  size = 44,
}: {
  icon: string;
  color: string;
  size?: number;
}) {
  return (
    <span
      aria-hidden
      className="border-edge grid shrink-0 place-items-center rounded-[2px] border-[3px] shadow-[2px_2px_0_var(--edge)]"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.5,
        background: `color-mix(in srgb, ${color} 45%, var(--panel-2))`,
      }}
    >
      {icon}
    </span>
  );
}
