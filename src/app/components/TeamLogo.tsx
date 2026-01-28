type TeamLogoProps = {
  src?: string | null;
  alt?: string;
  size?: number;
  className?: string;
  rounded?: boolean;
};

export default function TeamLogo({
  src,
  alt = "Team logo",
  size = 84,
  className = "",
  rounded = true
}: TeamLogoProps) {
  const classes = [
    "flex shrink-0 items-center justify-center overflow-hidden border border-white/40 bg-white/80 shadow-sm shadow-navy/10",
    rounded ? "rounded-2xl" : "rounded-md",
    className
  ]
    .filter(Boolean)
    .join(" ");
  const imageClasses = ["h-full w-full object-contain", rounded ? "rounded-2xl" : "rounded-md"]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} style={{ width: size, height: size }}>
      {src ? (
        <img
          src={src}
          alt={alt}
          className={imageClasses}
          loading="lazy"
        />
      ) : (
        <img
          src="/brand/wizyrd-logo.png"
          alt="Wizyrd logo"
          className={`${imageClasses} grayscale opacity-70`}
          loading="lazy"
        />
      )}
    </div>
  );
}
