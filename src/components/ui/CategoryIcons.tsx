import { Stethoscope, BookOpen, Utensils, Home as HomeIcon, Heart, type LucideIcon } from 'lucide-react';

export const CategoryIconMap: Record<string, LucideIcon> = {
  medical: Stethoscope,
  health: Stethoscope,
  education: BookOpen,
  food: Utensils,
  housing: HomeIcon,
  shelter: HomeIcon,
  community: Heart,
};
