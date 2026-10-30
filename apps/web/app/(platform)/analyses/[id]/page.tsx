import AnalysisWorkspace from "@/features/map/AnalysisWorkspace";

export default async function Analysis({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AnalysisWorkspace key={id} id={id} />;
}
