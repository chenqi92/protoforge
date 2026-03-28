-- Add variables column to collection_items for folder/request scoped variables
ALTER TABLE collection_items ADD COLUMN variables TEXT DEFAULT '[]';
