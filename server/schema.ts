export const SCHEMA = `
DEFINE TABLE IF NOT EXISTS source SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS key ON source TYPE string;
DEFINE FIELD IF NOT EXISTS type ON source TYPE string;
DEFINE FIELD IF NOT EXISTS authority_scope ON source TYPE option<string>;
DEFINE FIELD IF NOT EXISTS metadata ON source TYPE object;
DEFINE FIELD IF NOT EXISTS created_at ON source TYPE datetime;
DEFINE FIELD IF NOT EXISTS updated_at ON source TYPE datetime;
DEFINE INDEX IF NOT EXISTS source_key_unique ON source FIELDS key UNIQUE;

DEFINE TABLE IF NOT EXISTS entity SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS stable_key ON entity TYPE string;
DEFINE FIELD IF NOT EXISTS type ON entity TYPE string;
DEFINE FIELD IF NOT EXISTS label ON entity TYPE string;
DEFINE FIELD IF NOT EXISTS metadata ON entity TYPE object;
DEFINE FIELD IF NOT EXISTS created_at ON entity TYPE datetime;
DEFINE FIELD IF NOT EXISTS updated_at ON entity TYPE datetime;
DEFINE INDEX IF NOT EXISTS entity_key_unique ON entity FIELDS stable_key UNIQUE;
DEFINE INDEX IF NOT EXISTS entity_type_idx ON entity FIELDS type;

DEFINE TABLE IF NOT EXISTS observation SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS source ON observation TYPE record<source>;
DEFINE FIELD IF NOT EXISTS entity ON observation TYPE record<entity>;
DEFINE FIELD IF NOT EXISTS observed_at ON observation TYPE datetime;
DEFINE FIELD IF NOT EXISTS recorded_at ON observation TYPE datetime;
DEFINE FIELD IF NOT EXISTS coverage ON observation TYPE array<string>;
DEFINE FIELD IF NOT EXISTS snapshot_hash ON observation TYPE string;
DEFINE FIELD IF NOT EXISTS raw_payload ON observation TYPE any;
DEFINE FIELD IF NOT EXISTS status ON observation TYPE string;
DEFINE INDEX IF NOT EXISTS observation_entity_time ON observation FIELDS entity, observed_at;
DEFINE INDEX IF NOT EXISTS observation_source_time ON observation FIELDS source, observed_at;

DEFINE TABLE IF NOT EXISTS fact SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS observation ON fact TYPE record<observation>;
DEFINE FIELD IF NOT EXISTS entity ON fact TYPE record<entity>;
DEFINE FIELD IF NOT EXISTS attribute ON fact TYPE string;
DEFINE FIELD IF NOT EXISTS value ON fact TYPE any;
DEFINE FIELD IF NOT EXISTS valid_from ON fact TYPE datetime;
DEFINE FIELD IF NOT EXISTS valid_to ON fact TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS recorded_at ON fact TYPE datetime;
DEFINE INDEX IF NOT EXISTS fact_entity_attribute ON fact FIELDS entity, attribute;
DEFINE INDEX IF NOT EXISTS fact_valid_from ON fact FIELDS valid_from;

DEFINE TABLE IF NOT EXISTS relation SCHEMAFULL TYPE RELATION IN entity OUT entity ENFORCED;
DEFINE FIELD IF NOT EXISTS predicate ON relation TYPE string;
DEFINE FIELD IF NOT EXISTS observation ON relation TYPE record<observation>;
DEFINE FIELD IF NOT EXISTS source ON relation TYPE record<source>;
DEFINE FIELD IF NOT EXISTS valid_from ON relation TYPE datetime;
DEFINE FIELD IF NOT EXISTS valid_to ON relation TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS recorded_at ON relation TYPE datetime;
DEFINE INDEX IF NOT EXISTS relation_current ON relation FIELDS in, predicate, valid_to;

DEFINE ANALYZER IF NOT EXISTS observatory_text TOKENIZERS class, punct FILTERS lowercase, ascii;

DEFINE TABLE IF NOT EXISTS semantic_doc SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS target_type ON semantic_doc TYPE string;
DEFINE FIELD IF NOT EXISTS target_key ON semantic_doc TYPE string;
DEFINE FIELD IF NOT EXISTS text ON semantic_doc TYPE string;
DEFINE FIELD IF NOT EXISTS embedding ON semantic_doc TYPE array<float>;
DEFINE FIELD IF NOT EXISTS source_fact_ids ON semantic_doc TYPE array<string>;
DEFINE FIELD IF NOT EXISTS embedding_model ON semantic_doc TYPE string;
DEFINE FIELD IF NOT EXISTS created_at ON semantic_doc TYPE datetime;
DEFINE FIELD IF NOT EXISTS updated_at ON semantic_doc TYPE datetime;
DEFINE INDEX IF NOT EXISTS semantic_target_unique ON semantic_doc FIELDS target_type, target_key UNIQUE;
DEFINE INDEX IF NOT EXISTS semantic_text_idx ON semantic_doc FIELDS text FULLTEXT ANALYZER observatory_text BM25;
DEFINE INDEX IF NOT EXISTS semantic_embedding_hnsw ON semantic_doc FIELDS embedding HNSW DIMENSION 384 DIST COSINE;
`;
