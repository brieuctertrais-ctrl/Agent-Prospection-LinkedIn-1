/**
 * Greeting rule: « Bonjour Monsieur <Nom>, » / « Bonjour Madame <Nom>, ».
 * If the civility cannot be inferred from the first name, « Bonjour <Prénom> <Nom>, ».
 */

/** "Vincent BESSON, MBA" → "BESSON" ; "Jean-Pierre DE LA TOUR" → "DE LA TOUR" */
export function lastNameOf(fullName: string): string {
  const clean = fullName.split(/[,|(]/)[0].replace(/[^\p{L}\p{M}' -]/gu, " ").replace(/\s+/g, " ").trim();
  const parts = clean.split(" ");
  return parts.length > 1 ? parts.slice(1).join(" ") : "";
}

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** True if the note opens with a civility + last name (or full name fallback). */
export function greetingOk(text: string, firstName: string, lastName: string): boolean {
  const t = strip(text.trim());
  const ln = strip(lastName).split(/[\s-]/).filter(Boolean).pop() ?? "";
  if (!ln) return /^(bonjour|hello)\b/.test(t);
  const head = t.slice(0, 80);
  const civility = /^(bonjour (monsieur|madame)|hello (mr|mrs|ms)\.?) /.test(head);
  const fullName = firstName ? head.startsWith(`bonjour ${strip(firstName)} `) || head.startsWith(`hello ${strip(firstName)} `) : false;
  return (civility || fullName) && head.split(",")[0].includes(ln);
}
