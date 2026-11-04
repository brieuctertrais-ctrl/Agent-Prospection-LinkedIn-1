"use client";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sendToExtension } from "@/lib/extension";

/** Sets the active persona in the extension (if installed) and opens LinkedIn. */
export function ProspectButton({ label, personaId, size }: { label: string; personaId?: string; size?: "sm" | "default" }) {
  return (
    <Button
      size={size}
      onClick={async () => {
        if (personaId) await sendToExtension({ type: "SET_ACTIVE_PERSONA", personaId }).catch(() => undefined);
        window.open("https://www.linkedin.com/feed/", "_blank", "noopener");
      }}
    >
      {label} <ArrowUpRight className="h-4 w-4" />
    </Button>
  );
}
