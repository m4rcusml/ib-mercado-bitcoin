import type { IconName } from "@/components/icon";

export type View = "overview" | "transfers" | "activity" | "lab";

export interface NavigationItem {
  id: View;
  title: string;
  icon: IconName;
}

export const navigation: NavigationItem[] = [
  { id: "overview", title: "Visão geral", icon: "overview" },
  { id: "transfers", title: "Transferências", icon: "transfer" },
  { id: "activity", title: "Atividade", icon: "activity" },
  { id: "lab", title: "Laboratório", icon: "lab" },
];
