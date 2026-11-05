"use client";
import { useTransition } from "react";
import { Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pauseCampaign } from "./actions";

export function PauseButton({ campaignId, label }: { campaignId: string; label: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await pauseCampaign(campaignId);
        })
      }
    >
      <Pause className="h-4 w-4" /> {label}
    </Button>
  );
}
