import ExperimentWorkspace from "@/features/experiments/ExperimentWorkspace";

export default async function ExperimentStudyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ExperimentWorkspace id={id} />;
}
