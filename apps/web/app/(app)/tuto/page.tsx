import { getT } from "@/lib/i18n";
import { Card } from "@/components/ui/card";

// Replace the URLs with your own tutorial videos (YouTube/Loom embed links).
const VIDEOS = [
  { key: "tuto.video1", url: "" },
  { key: "tuto.video2", url: "" },
  { key: "tuto.video3", url: "" },
  { key: "tuto.video4", url: "" },
] as const;

export default async function TutoPage() {
  const { t } = await getT();
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-6 text-3xl font-bold">{t("tuto.title")}</h1>
      <div className="grid gap-6 md:grid-cols-2">
        {VIDEOS.map((v) => (
          <Card key={v.key} className="p-4">
            <div className="mb-3 flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-navy-dark">
              {v.url ? (
                <iframe src={v.url} className="h-full w-full" allowFullScreen title={t(v.key)} />
              ) : (
                <img src="/mascot.svg" alt="" width={64} height={64} className="h-16 w-16 opacity-60" />
              )}
            </div>
            <p className="font-medium">{t(v.key)}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
