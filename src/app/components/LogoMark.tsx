import Image from "next/image";

type LogoMarkProps = {
  size?: number;
  scale?: number;
  className?: string;
  priority?: boolean;
  unoptimized?: boolean;
};

export default function LogoMark({
  size = 56,
  scale,
  className = "",
  priority = false,
  unoptimized = true
}: LogoMarkProps) {
  const scaleFactor = scale ?? 6.25;
  const width = Math.round(size * scaleFactor);
  const height = Math.round(((size * 2) / 3) * scaleFactor);
  const classes = [
    "drop-shadow-[0_18px_35px_rgba(9,24,44,0.45)]",
    className
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Image
      src="/brand/wizyrd-logo.png"
      alt="Wizyrd logo"
      width={width}
      height={height}
      priority={priority}
      unoptimized={unoptimized}
      className={classes}
    />
  );
}
