import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@kairo/shared";

export function Logo({ withAvatar = true }: { withAvatar?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      {withAvatar && <img src="/mascot.svg" alt="" width={36} height={36} className="h-9 w-9 rounded-full" />}
      <span className="font-display text-2xl uppercase leading-none tracking-wide text-white">
        {PRODUCT_NAME} <span className="text-gold">{PRODUCT_TAGLINE}</span>
      </span>
    </div>
  );
}
