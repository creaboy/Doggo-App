import { colors } from "./theme";

export const environmentLabels: Record<string, string> = {
  forest: "Forêt", fields: "Champs", city: "Ville", beach: "Plage", mountain: "Montagne", mixed: "Mixte",
};
export const difficultyLabels: Record<string, string> = { easy: "Facile", moderate: "Modérée", sporty: "Sportive" };
export const freedomLabels: Record<string, string> = { free: "Sans laisse", partial: "Sans laisse partiel", leash: "Laisse obligatoire" };
export const featureLabels: Record<string, string> = {
  shade: "Ombragé", water: "Eau", swimming: "Baignade", parking: "Parking", low_traffic: "Peu de circulation", quiet: "Calme", easy_path: "Chemin facile",
};

export const poiTypeLabels: Record<string, string> = {
  water: "Eau", swimming: "Baignade chien", parking: "Parking", viewpoint: "Point de vue", trash: "Poubelle", other: "Autre",
};

export const hazardTypeLabels: Record<string, string> = {
  cars: "Route dangereuse", crossing: "Traversée de route", caterpillars: "Chenilles", boars: "Sangliers",
  livestock: "Bétail", aggressive_dogs: "Chiens agressifs", toxic: "Plantes/nourriture toxiques", hunting: "Chasse",
  path_closed: "Chemin fermé", dogs_prohibited: "Chiens interdits", other: "Autre",
};

export const freedomColor = { free: colors.success, caution: colors.warning, leash: colors.error };
export const walkFreedomColor: Record<string, string> = { free: colors.success, partial: colors.warning, leash: colors.error };

export function timeAgo(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const day = 86400000;
  if (diff < 3600000) return `il y a ${Math.max(1, Math.floor(diff / 60000))} min`;
  if (diff < day) return `il y a ${Math.floor(diff / 3600000)} h`;
  const days = Math.floor(diff / day);
  if (days < 30) return `il y a ${days} j`;
  return `il y a ${Math.floor(days / 30)} mois`;
}

export function formatDuration(min: number) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}
