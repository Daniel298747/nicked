// The product never accuses anyone: it describes actions. These words are
// checked in AI output (reasons and incident reports) and flagged if they appear.
const LOADED_TERMS =
  /\b(thief|thieves|theft|thefts|steal|steals|stealing|stole|stolen|shoplift\w*|nicked|nicking|criminal|crime|crimes|guilty|suspect|suspects|suspected|suspicious|perpetrator|culprit|offender)\b/gi;

export function findLoadedTerms(text = '') {
  return [...new Set((String(text).match(LOADED_TERMS) || []).map((t) => t.toLowerCase()))];
}
