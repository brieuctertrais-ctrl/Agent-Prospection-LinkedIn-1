import { INVITATION_MAX_CHARS } from "./constants.ts";

export interface InvitationCheck {
  ok: boolean;
  chars: number;
  errors: string[];
}

/** Validates an invitation note against LinkedIn constraints and our generation rules. */
export function checkInvitation(text: string, firstName?: string): InvitationCheck {
  const errors: string[] = [];
  const chars = [...text].length;
  if (!text.trim()) errors.push("empty");
  if (chars > INVITATION_MAX_CHARS) errors.push("too_long");
  if (firstName && !text.trim().toLowerCase().startsWith(`bonjour ${firstName.toLowerCase()}`) &&
      !text.trim().toLowerCase().startsWith(`hello ${firstName.toLowerCase()}`) &&
      !text.trim().toLowerCase().startsWith(`hi ${firstName.toLowerCase()}`)) {
    errors.push("bad_greeting");
  }
  if ((text.match(/\?/g) ?? []).length > 1) errors.push("multiple_questions");
  return { ok: errors.length === 0, chars, errors };
}
