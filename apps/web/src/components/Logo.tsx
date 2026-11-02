import gearAnimated from "@/assets/gear.gif";
import gearStill from "@/assets/gear.png";
import wordmarkAnimated from "@/assets/logo.gif";
import wordmarkStill from "@/assets/logo.png";

const IMAGES = {
  wordmark: { animated: wordmarkAnimated, still: wordmarkStill },
  gear: { animated: gearAnimated, still: gearStill },
};

/** The spinning-gear logo, with or without the wordmark. Viewers who ask for reduced motion get the still image. */
export function Logo({
  className,
  variant = "wordmark",
  still: alwaysStill = false,
}: {
  className?: string;
  variant?: keyof typeof IMAGES;
  still?: boolean;
}) {
  const { animated, still } = IMAGES[variant];
  if (alwaysStill) return <img src={still} alt="Drafty" className={className} />;
  return (
    <picture className="contents">
      <source srcSet={still} media="(prefers-reduced-motion: reduce)" />
      <img src={animated} alt="Drafty" className={className} />
    </picture>
  );
}
