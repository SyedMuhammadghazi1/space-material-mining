-- Integrity guards that must hold even if application code is wrong.

-- 1) The inventory ledger is append-only.
CREATE OR REPLACE FUNCTION ledger_entries_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only (% rejected)', TG_OP USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER ledger_entries_no_update_delete
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_append_only();
--> statement-breakpoint

-- 2) Mission scenario snapshots are immutable once computed.
CREATE OR REPLACE FUNCTION mission_scenarios_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.inputs IS DISTINCT FROM OLD.inputs
     OR NEW.results IS DISTINCT FROM OLD.results
     OR NEW.target_snapshot IS DISTINCT FROM OLD.target_snapshot
     OR NEW.model_version IS DISTINCT FROM OLD.model_version
     OR NEW.target_id IS DISTINCT FROM OLD.target_id
     OR NEW.process_id IS DISTINCT FROM OLD.process_id
     OR NEW.delivery_node IS DISTINCT FROM OLD.delivery_node
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'mission scenario snapshots are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER mission_scenarios_no_mutation
  BEFORE UPDATE ON mission_scenarios
  FOR EACH ROW EXECUTE FUNCTION mission_scenarios_immutable();
