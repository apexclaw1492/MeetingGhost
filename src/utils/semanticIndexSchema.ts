/**
 * Persisted semantic indexes are valid only for this exact embedding contract.
 * Bump this value whenever the model, pooling, normalization, or chunking
 * semantics change so older vectors are visibly rebuilt instead of mixed.
 */
export const SEMANTIC_INDEX_SCHEMA = 'xenova-all-minilm-l6-v2-mean-normalized-chunks-v1';
