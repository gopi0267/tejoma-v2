// Shape of a row this service owns directly - mirrors the monolith's recruiter_notifications
// table (schema.sql "Table: recruiter_notifications") minus the three FKs this service's own
// migration deliberately drops (migrations/001_initial_schema.up.sql's header comment explains
// why - same cross-service-FK-elimination precedent as candidate_decisions/mutual_matches and
// knowledge_base_chunks.company_id in earlier batches).
export interface RecruiterNotification {
  id: number;
  user_id: number;
  company_id: number;
  match_id: number;
  type: string;
  title: string;
  message: string;
  read_at: string | null;
  created_at: string;
}
