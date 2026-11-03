import { cn } from "@/lib/utils";
import gearAnimated from "@/assets/gear.gif";
import gearStill from "@/assets/gear.png";
import wordmarkAnimated from "@/assets/logo.gif";
import wordmarkStill from "@/assets/logo.png";

const IMAGES = {
  wordmark: { animated: wordmarkAnimated, still: wordmarkStill },
  gear: { animated: gearAnimated, still: gearStill },
};

/** The spinning-gear logo, with or without the wordmark. The animation always plays unless `still` is set. */
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
  // The artwork is black; in dark mode invert it and screen away any background box.
  className = cn(className, "dark:invert dark:mix-blend-screen");
  return <img src={alwaysStill ? still : animated} alt="Drafty" className={className} />;
}
