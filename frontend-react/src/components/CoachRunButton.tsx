import { useState } from "react";
import { analyzeApplication, buildAnalyzePayload } from "@/lib/api/scholarE";
import { useUser } from "@/lib/userStore";

type CoachRunButtonProps = {
  label: string;
  loadingLabel?: string;
  disabled?: boolean;
  className?: string;
  onStatus?: (message: string) => void;
};

export function CoachRunButton({
  label,
  loadingLabel = "Analyzing…",
  disabled,
  className,
  onStatus,
}: CoachRunButtonProps) {
  const { user, updateProfile } = useUser();
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  async function run() {
    const payload = buildAnalyzePayload(user);
    if (
      !payload.cv_text ||
      !payload.essay_text ||
      !payload.scholarship_name ||
      !payload.scholarship_type ||
      !payload.prompt
    ) {
      onStatus?.(
        "Add your profile, scholarship details, and essay draft before running the AI coach.",
      );
      return;
    }

    setIsAnalyzing(true);
    onStatus?.("Analyzing…");
    try {
      const result = await analyzeApplication(payload);
      updateProfile({ lastAnalysis: result });
      onStatus?.("Analysis complete. Continue to Application Evaluation to review your scores.");
    } catch (error) {
      onStatus?.((error as Error).message || "Scholar-E analysis failed.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  return (
    <button type="button" onClick={run} disabled={disabled || isAnalyzing} className={className}>
      {isAnalyzing ? loadingLabel : label}
    </button>
  );
}
