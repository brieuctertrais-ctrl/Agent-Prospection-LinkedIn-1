"use client";
/**
 * Extracts the text of a PDF / TXT / MD file IN THE BROWSER: the file itself is never uploaded.
 * PDF.js 6 never evaluates code from the PDF; only plain text comes out (displayed and stored as text).
 */
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_PAGES = 60;
export const MAX_CHARS = 20_000; // same limit as knowledge_docs.content

export interface Extracted {
  title: string;
  text: string;
  truncated: boolean;
}

const tidy = (s: string) =>
  s
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export async function extractText(file: File): Promise<Extracted> {
  if (file.size > MAX_FILE_BYTES) throw new Error("file_too_large");
  const title = file.name.replace(/\.[^.]+$/, "").slice(0, 200);
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  const isText = /^text\//.test(file.type) || /\.(txt|md|markdown)$/i.test(file.name);

  let raw = "";
  if (isPdf) {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    // PDF.js 6 never evaluates code coming from the PDF (no eval / new Function in the library).
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    const doc = await task.promise;
    const pages = Math.min(doc.numPages, MAX_PAGES);
    const parts: string[] = [];
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      parts.push(
        content.items
          .map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : " ") : ""))
          .join(""),
      );
      if (parts.join("\n\n").length > MAX_CHARS) break;
    }
    await task.destroy();
    raw = parts.join("\n\n");
  } else if (isText) {
    raw = await file.text();
  } else {
    throw new Error("unsupported_type");
  }

  const text = tidy(raw);
  if (!text) throw new Error("no_text");
  return { title, text: text.slice(0, MAX_CHARS), truncated: text.length > MAX_CHARS };
}
