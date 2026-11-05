"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";

const DocSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(20000),
});

export async function addDoc(fd: FormData) {
  const parsed = DocSchema.safeParse({ title: fd.get("title"), content: fd.get("content") });
  if (!parsed.success) return;
  const { supabase, user } = await requireUser();
  await supabase.from("knowledge_docs").insert({ user_id: user.id, ...parsed.data });
  revalidatePath("/knowledge");
}

export async function deleteDoc(fd: FormData) {
  const id = z.string().uuid().safeParse(fd.get("id"));
  if (!id.success) return;
  const { supabase, user } = await requireUser();
  await supabase.from("knowledge_docs").delete().eq("id", id.data).eq("user_id", user.id);
  revalidatePath("/knowledge");
}
