// Deterministic, local-only formatting. Never infer commas from pause length:
// recognition boundaries are not necessarily sentence/clause boundaries.
export function formatDictation(text: string, options: { language: string; sentenceStart: boolean; finish?: boolean }) {
  if (!/^en(?:-|$)/i.test(options.language)) return text
  // Leave code, URLs, file paths, lists, and multiline/structured drafts alone.
  if (/[\n\r`{}[\]<>\\/]|\b(?:https?:|www\.)|(?:^|\s)[-$#@]/i.test(text)) return text
  let result = text.replace(/ +([,;:!?])/g, '$1').replace(/([,;!?])(?=[A-Za-z])/g, '$1 ')
  // Restrict capitalization to explicit sentence starts, not every restart/pause.
  if (options.sentenceStart) result = result.replace(/^(\s*["“'(]*)([a-z])/, (_, prefix, letter) => prefix + letter.toUpperCase())
  result = result.replace(/\b([A-Za-z]+)([.!?]\s+)([a-z])/g, (_, word, boundary, letter) => {
    const abbreviation = boundary.startsWith('.') && (word.length === 1 || /^(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc)$/i.test(word))
    return word + boundary + (abbreviation ? letter : letter.toUpperCase())
  })
  if (options.finish) {
    result = result.trimEnd()
    // Conservative prose heuristic: no guessed questions or mid-sentence commas,
    // no punctuation after a dangling comma/colon/dash or a numeric identifier.
    if (/[A-Za-z]$/.test(result) && !/\b(?:Mr|Mrs|Ms|Dr|Prof|vs|etc)$/i.test(result)) result += '.'
  }
  return result
}

export function startsDictatedSentence(base: string) {
  return !base.trim() || /[.!?]["”')]*\s*$/.test(base) || /\n\s*$/.test(base)
}
