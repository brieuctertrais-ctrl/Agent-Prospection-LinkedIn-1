"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sendToExtension } from "@/lib/extension";

/** Asks the extension to read the user's own LinkedIn profile + company page, then opens the pre-filled form. */
export function OnboardingButton({ labels }: { labels: { button: string; running: string; error: string; noExt: string } }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running" | "error" | "noExt">("idle");
  return (
    <div className="space-y-2">
      <Button
        disabled={state === "running"}
        onClick={async () => {
          setState("running");
          try {
            const r = await sendToExtension<{ ok?: boolean }>({ type: "SUGGEST_PERSONA" });
            if (r?.ok) {
              setState("idle");
              router.push("/personas/new?from=linkedin");
            } else setState("error");
          } catch {
            setState("noExt");
          }
        }}
      >
        <Sparkles className="h-4 w-4" /> {state === "running" ? labels.running : labels.button}
      </Button>
      {state === "error" && <p className="text-sm text-red-300">{labels.error}</p>}
      {state === "noExt" && <p className="text-sm text-red-300">{labels.noExt}</p>}
    </div>
  );
}
