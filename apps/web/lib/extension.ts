"use client";

interface ExternalRuntime {
  sendMessage: (id: string, msg: unknown, cb: (r: unknown) => void) => void;
  lastError?: { message?: string };
}

/** Sends a message to the Chrome extension through `externally_connectable`. */
export function sendToExtension<T = unknown>(message: unknown): Promise<T> {
  const id = process.env.NEXT_PUBLIC_EXTENSION_ID;
  const runtime = (window as unknown as { chrome?: { runtime?: ExternalRuntime } }).chrome?.runtime;
  return new Promise((resolve, reject) => {
    if (!id || !runtime?.sendMessage) return reject(new Error("extension_unavailable"));
    try {
      runtime.sendMessage(id, message, (response) => {
        if (runtime.lastError) reject(new Error(runtime.lastError.message));
        else resolve(response as T);
      });
    } catch (e) {
      reject(e);
    }
  });
}
