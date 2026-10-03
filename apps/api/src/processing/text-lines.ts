const MAX_LINE_CHARS = 1000;

/** NFC and CRLF/CR → LF, the line-normalisation rule for text sources (07 §11). */
export function normalizeText(text: string): string {
  return text.normalize('NFC').replace(/\r\n?/g, '\n');
}

/**
 * Splits normalised text into persisted lines (07 §11): one per LF, empty lines dropped, and
 * lines over 1,000 characters segmented at the last whitespace before the limit (hard split
 * only when there is none).
 */
export function splitLines(text: string): string[] {
  const lines: string[] = [];
  for (const line of normalizeText(text).split('\n')) {
    if (line.trim() === '') continue;
    lines.push(...segment(line));
  }
  return lines;
}

function segment(line: string): string[] {
  const parts: string[] = [];
  let rest = [...line];
  while (rest.length > MAX_LINE_CHARS) {
    const window = rest.slice(0, MAX_LINE_CHARS);
    let cut = -1;
    for (let i = window.length - 1; i > 0; i -= 1) {
      if (/\s/.test(window[i]!)) {
        cut = i;
        break;
      }
    }
    const end = cut > 0 ? cut : MAX_LINE_CHARS;
    parts.push(rest.slice(0, end).join(''));
    rest = rest.slice(cut > 0 ? end + 1 : end);
  }
  if (rest.length > 0) parts.push(rest.join(''));
  return parts;
}
