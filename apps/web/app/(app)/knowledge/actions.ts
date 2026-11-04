"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";

export async function addDoc(fd: FormData) {
  const { supabase, user } = await requireUser();
  const title = String(fd.get("title") ?? "").trim().slice(0, 200);
  const content = String(fd.get("content") ?? "").trim().slice(0, 20000);
  if (!title || !content) return;
  await supabase.from("knowledge_docs").insert({ user_id: user.id, title, content });
  revalidatePath("/knowledge");
}

export async function deleteDoc(fd: FormData) {
  const { supabase } = await requireUser();
  await supabase.from("knowledge_docs").delete().eq("id", String(fd.get("id")));
  revalidatePath("/knowledge");
}
