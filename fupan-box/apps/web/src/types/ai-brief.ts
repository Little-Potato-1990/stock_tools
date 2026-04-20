export type Trend = "up" | "down" | "flat";
export type Regime = "consensus" | "climax" | "diverge" | "repair";
export type LineStatus = "rising" | "peak" | "diverge" | "fading";
export type AnnotationLevel = "info" | "positive" | "warning" | "negative";
export type AiGrade = "S" | "A" | "B" | "C";
export type RiskLevel = "low" | "medium" | "high";

export interface KeyMetric {
  label: string;
  value: string;
  delta: string;
  trend: Trend;
  anchor?: string;
}

export interface MainLine {
  rank: number;
  name: string;
  change_pct: number;
  limit_up_count: number;
  ai_reason: string;
  leader_code: string;
  leader_name: string;
  leader_pct: number;
  status: LineStatus;
  recent_lu_counts?: number[];
}

export interface LeaderAnnotation {
  time: string;
  label: string;
  level: AnnotationLevel;
}

export interface Leader {
  code: string;
  name: string;
  board: number;
  change_pct: number;
  ai_grade: AiGrade;
  ai_summary: string;
  annotations: LeaderAnnotation[];
}

export interface PlanPromotion {
  code: string;
  name: string;
  board: number;
  trigger: string;
  risk: RiskLevel;
}

export interface PlanFirstBoard {
  code: string;
  name: string;
  theme: string;
  trigger: string;
  risk: RiskLevel;
}

export interface PlanReseal {
  code: string;
  name: string;
  trigger: string;
  risk: RiskLevel;
}

export interface PlanAvoid {
  code: string;
  name: string;
  reason: string;
}

export interface TomorrowPlan {
  promotion: PlanPromotion[];
  first_board: PlanFirstBoard[];
  reseal: PlanReseal[];
  avoid: PlanAvoid[];
}

export interface SimilarDayDelta {
  name: string;
  today: number;
  then: number;
  delta: number;
}

export interface SimilarDay {
  trade_date: string;
  similarity: number;
  next_3d: number[];
  summary: string;
  delta?: SimilarDayDelta[];
}

export type SimilarTilt = "延续" | "反转" | "震荡";

export interface SimilarJudgment {
  tilt: SimilarTilt;
  probability: number;
  key_risk: string;
  note: string;
}

export interface AiBrief {
  trade_date: string;
  generated_at: string;
  model: string;
  tagline: string;
  regime: Regime;
  regime_label: string;
  key_metrics: KeyMetric[];
  main_lines: MainLine[];
  leaders: Leader[];
  tomorrow_plan: TomorrowPlan;
  similar_days: SimilarDay[];
  similar_judgment?: SimilarJudgment;
  evidence?: string[];
}
