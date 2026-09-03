import { colors } from "./theme";

export const environmentLabels: Record<string, string> = {
  forest: "Forest", fields: "Fields", city: "City", beach: "Beach", mountain: "Mountain", mixed: "Mixed",
};
export const difficultyLabels: Record<string, string> = { easy: "Easy", moderate: "Moderate", sporty: "Sporty" };
export const freedomLabels: Record<string, string> = { free: "Off-leash", partial: "Partially off-leash", leash: "Leash required" };
export const featureLabels: Record<string, string> = {
  shade: "Shade", water: "Water", swimming: "Swimming", parking: "Parking", low_traffic: "Low traffic", quiet: "Quiet", easy_path: "Easy path",
};

export const poiTypeLabels: Record<string, string> = {
  water: "Water", swimming: "Dog swim", parking: "Parking", viewpoint: "Viewpoint", trash: "Trash bin", other: "Other",
};

export const hazardTypeLabels: Record<string, string> = {
  cars: "Dangerous road", crossing: "Road crossing", caterpillars: "Caterpillars", boars: "Wild boars",
  livestock: "Livestock", aggressive_dogs: "Aggressive dogs", toxic: "Toxic plants/food", hunting: "Hunting",
  path_closed: "Path closed", dogs_prohibited: "Dogs prohibited", other: "Other",
};

export const freedomColor = { free: colors.success, caution: colors.warning, leash: colors.error };
export const walkFreedomColor: Record<string, string> = { free: colors.success, partial: colors.warning, leash: colors.error };

export function timeAgo(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const day = 86400000;
  if (diff < 3600000) return `${Math.max(1, Math.floor(diff / 60000))}m ago`;
  if (diff < day) return `${Math.floor(diff / 3600000)}h ago`;
  const days = Math.floor(diff / day);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function formatDuration(min: number) {
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}
