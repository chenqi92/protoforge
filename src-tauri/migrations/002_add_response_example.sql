-- Add response_example column to collection_items
ALTER TABLE collection_items ADD COLUMN response_example TEXT DEFAULT '';
