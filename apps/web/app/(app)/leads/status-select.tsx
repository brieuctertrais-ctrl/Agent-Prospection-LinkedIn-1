"use client";
import { useTransition } from "react";
import { LEAD_STATUSES, type LeadStatus } from "@kairo/shared";
import { Select } from "@/components/ui/select";
import { updateLeadStatus } from "./actions";

export function StatusSelect({ id, value, labels }: { id: string; value: LeadStatus; labels: Record<LeadStatus, string> }) {
  const [pending, start] = useTransition();
  return (
    <Select
      className="h-8 text-xs"
      disabled={pending}
      defaultValue={value}
      onChange={(e) => start(() => updateLeadStatus(id, e.target.value as LeadStatus))}
    >
      {LEAD_STATUSES.map((s) => (
        <option key={s} value={s}>{labels[s]}</option>
      ))}
    </Select>
  );
}
