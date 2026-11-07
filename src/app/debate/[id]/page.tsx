import { notFound } from "next/navigation";
import { DebateRoom } from "@/components/debate-room";
import { getDebateView } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function DebatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ fresh?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const view = getDebateView(id);
  if (!view) notFound();

  return (
    <DebateRoom
      initialView={view}
      autoStart={
        query.fresh === "1" ||
        view.debate.status === "active" ||
        view.debate.status === "judging"
      }
    />
  );
}
