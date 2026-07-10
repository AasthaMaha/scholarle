import { useState } from "react";
import { analyzeApplication, buildAnalyzePayload } from "@/lib/api/scholarE";
import { useUser } from "@/lib/userStore";

type CoachRunButtonProps = {
  label: string;
  loadingLabel?: string;
  disabled?: boolean;
  fitOnly?: boolean;
  className?: string;
  onStatus?: (message: string) => void;
  onRunningChange?: (running: boolean) => void;
};

export function CoachRunButton({
  label,
  loadingLabel = "Analyzing…",
  disabled,
  fitOnly = false,
  className,
  onStatus,
  onRunningChange,
}: CoachRunButtonProps) {
  const { user, updateProfile } = useUser();
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  async function run() {
    const payload = buildAnalyzePayload(user);
    if (fitOnly) {
      payload.essay_text = payload.essay_text || "Fit-only analysis requested before essay draft is available.";
      payload.scholarship_name = payload.scholarship_name || "Scholarship opportunity";
      payload.scholarship_type = payload.scholarship_type || "Scholarship";
    }

    if (!payload.cv_text || !payload.prompt || (!fitOnly && (!payload.essay_text || !payload.scholarship_name || !payload.scholarship_type))) {
      onStatus?.(
        fitOnly
          ? "Add your profile and scholarship details before analyzing fit."
          : "Add your profile, scholarship details, and essay draft before running the AI coach.",
      );
      return;
    }

    setIsAnalyzing(true);
    onRunningChange?.(true);
    onStatus?.("Analyzing…");
    try {
      const result = await analyzeApplication(payload);
      updateProfile({ lastAnalysis: result });
      onStatus?.(
        fitOnly
          ? "Fit analysis complete. Review the results below."
          : "Analysis complete. Continue to Application Evaluation to review your scores.",
      );
    } catch (error) {
      onStatus?.((error as Error).message || "Scholar-E analysis failed.");
    } finally {
      setIsAnalyzing(false);
      onRunningChange?.(false);
    }
  }

  return (
    <button type="button" onClick={run} disabled={disabled || isAnalyzing} className={className}>
      {isAnalyzing ? loadingLabel : label}
    </button>
  );
}
