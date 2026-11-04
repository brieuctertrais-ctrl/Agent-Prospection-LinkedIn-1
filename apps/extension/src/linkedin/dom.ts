import { SELECTORS, type SelectorKey } from "./selectors";

export function query<T extends Element = HTMLElement>(key: SelectorKey, root: ParentNode = document): T | null {
  const def = SELECTORS[key] as { css: string[]; texts?: string[] };
  for (const css of def.css) {
    try {
      const el = root.querySelector<T>(css);
      if (el && isVisible(el)) return el;
    } catch {
      /* :has() unsupported or invalid selector — try next */
    }
  }
  if (def.texts) return findByText<T>(def.texts, root);
  return null;
}

export function queryAll<T extends Element = HTMLElement>(key: SelectorKey, root: ParentNode = document): T[] {
  const def = SELECTORS[key] as { css: string[] };
  for (const css of def.css) {
    try {
      const els = Array.from(root.querySelectorAll<T>(css));
      if (els.length) return els;
    } catch {
      /* next */
    }
  }
  return [];
}

function findByText<T extends Element>(texts: string[], root: ParentNode): T | null {
  const wanted = texts.map((t) => t.toLowerCase());
  const candidates = Array.from(root.querySelectorAll<HTMLElement>("button, div[role='button'], a[role='button']"));
  for (const el of candidates) {
    if (!isVisible(el)) continue;
    const label = (el.innerText || el.getAttribute("aria-label") || "").trim().toLowerCase();
    if (wanted.includes(label)) return el as unknown as T;
  }
  return null;
}

export function isVisible(el: Element): boolean {
  const r = (el as HTMLElement).getBoundingClientRect?.();
  return !r || r.width > 0 || r.height > 0;
}

export const text = (el: Element | null | undefined) => (el as HTMLElement | null)?.innerText?.replace(/\s+/g, " ").trim() ?? "";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const humanPause = (min = 400, max = 1200) => sleep(min + Math.random() * (max - min));

export async function waitFor<T>(fn: () => T | null | undefined | false, timeout = 6000, interval = 200): Promise<T | null> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = fn();
    if (v) return v;
    await sleep(interval);
  }
  return null;
}

/** Sets a textarea value so that React/Ember listeners notice the change. */
export function setNativeValue(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export function pageMatches(patterns: RegExp[]): boolean {
  const body = document.body?.innerText ?? "";
  return patterns.some((p) => p.test(body));
}

export function dialogMatches(patterns: RegExp[]): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>("div[role='dialog'], .artdeco-modal, .artdeco-toast-item")).some((d) =>
    patterns.some((p) => p.test(d.innerText)),
  );
}
