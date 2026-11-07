import { DebateSetup } from "@/components/debate-setup";

export const dynamic = "force-dynamic";

export default async function NewDebatePage({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string }>;
}) {
  const params = await searchParams;
  return <DebateSetup initialTopic={params.topic ?? ""} />;
}
