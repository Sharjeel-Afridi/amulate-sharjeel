/**
 * Ranking lives in its own package so it can be verified in isolation — it is
 * pure arithmetic over listings and stated preferences, with no I/O and no model
 * involvement. The agent supplies the wording of a rationale, never the score.
 */
export { rankListings as rank } from '@car/ranking'
