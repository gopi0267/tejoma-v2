// Ported from the monolith's src/types.ts - RoleProfile only. Byte-identical shape.

export interface RoleProfile {
  id: number;
  role_key: string;
  display_name: string;
  mandatory_skills: string[];
  preferred_skills: string[];
  optional_skills: string[];
  common_tools: string[];
  typical_responsibilities: string[];
  preferred_certifications: string[];
  experience_band_min: number | null;
  experience_band_max: number | null;
  related_roles: string[];
  career_progression: string[];
  embedding: number[] | null;
  source: string;
  created_at: string;
  updated_at: string;
}
