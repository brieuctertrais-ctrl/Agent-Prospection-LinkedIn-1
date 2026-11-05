import { INVITATION_MAX_CHARS } from "./constants.ts";

export interface InvitationCheck {
  ok: boolean;
  chars: number;
  errors: string[];
}

/** Validates an invitation note against LinkedIn constraints and our generation rules. */
export function checkInvitation(text: string, firstName?: string, lastName?: string): InvitationCheck {
  const errors: string[] = [];
  const chars = [...text].length;
  if (!text.trim()) errors.push("empty");
  if (chars > INVITATION_MAX_CHARS) errors.push("too_long");
  if (lastName !== undefined && !greetingOk(text, firstName ?? "", lastName)) errors.push("bad_greeting");
  if ((text.match(/\?/g) ?? []).length > 1) errors.push("multiple_questions");
  return { ok: errors.length === 0, chars, errors };
}

const strip = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Same rule as the Edge Function: « Bonjour Monsieur|Madame <Nom>, » (or « Bonjour <Prénom> <Nom>, »). */
export function greetingOk(text: string, firstName: string, lastName: string): boolean {
  const t = strip(text.trim());
  const ln = strip(lastName).split(/[\s-]/).filter(Boolean).pop() ?? "";
  if (!ln) return /^(bonjour|hello)\b/.test(t);
  const head = t.slice(0, 80);
  const civility = /^(bonjour (monsieur|madame)|hello (mr|mrs|ms)\.?) /.test(head);
  const fullName = firstName ? head.startsWith(`bonjour ${strip(firstName)} `) || head.startsWith(`hello ${strip(firstName)} `) : false;
  return (civility || fullName) && head.split(",")[0].includes(ln);
}
