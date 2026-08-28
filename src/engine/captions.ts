/* ═══════════════════════════════════════════════════════════════════
   Subtitle interchange — import and export SRT / WebVTT / SBV / ASS.

   Parsing is deliberately forgiving: real-world caption files arrive with
   BOMs, CRLF endings, comma-or-dot decimals, missing cue numbers and
   inline markup. Everything normalises to `CaptionCue`.
   ═══════════════════════════════════════════════════════════════════ */

export interface CaptionCue {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  /** Alignment hint, when the format carries one. */
  align?: 'left' | 'center' | 'right';
}

export type CaptionFormat = 'srt' | 'vtt' | 'sbv' | 'ass' | 'json';

export interface ParseReport {
  format: CaptionFormat;
  cues: CaptionCue[];
  warnings: string[];
}

/* ── Timecode helpers ───────────────────────────────────────────── */

/**
 * Parse `HH:MM:SS,mmm`, `HH:MM:SS.mmm`, `MM:SS.mmm` or ASS `H:MM:SS.cc`.
 * Returns NaN when the shape is unrecognisable.
 */
export function parseTimecode(raw: string): number {
  const s = raw.trim().replace(',', '.');
  const parts = s.split(':');
  if (parts.length < 2 || parts.length > 3) return NaN;

  const secondsPart = parts[parts.length - 1];
  const seconds = parseFloat(secondsPart);
  if (Number.isNaN(seconds)) return NaN;

  const minutes = parseInt(parts[parts.length - 2], 10);
  if (Number.isNaN(minutes)) return NaN;

  const hours = parts.length === 3 ? parseInt(parts[0], 10) : 0;
  if (Number.isNaN(hours)) return NaN;

  // ASS uses centiseconds (`0:00:01.50`); the float parse already handles it.
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}

export function formatTimecode(ms: number, format: CaptionFormat = 'srt'): string {
  const clamped = Math.max(0, Math.round(ms));
  const totalSeconds = Math.floor(clamped / 1000);
  const millis = clamped % 1000;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  const pad = (n: number, w = 2) => n.toString().padStart(w, '0');

  if (format === 'ass') {
    // ASS wants H:MM:SS.cc with centisecond precision.
    return `${h}:${pad(m)}:${pad(s)}.${pad(Math.floor(millis / 10))}`;
  }
  if (format === 'sbv') {
    return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(millis, 3)}`;
  }
  const sep = format === 'vtt' ? '.' : ',';
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(millis, 3)}`;
}

/* ── Text cleanup ───────────────────────────────────────────────── */

const TAG_PATTERNS: [RegExp, string][] = [
  [/\{\\[^}]*\}/g, ''],           // ASS override blocks: {\an8}
  [/<\/?[^>]+>/g, ''],            // HTML-ish: <i>, <c.yellow>, <v Speaker>
  [/\\N|\\n/g, '\n'],             // ASS line breaks
  [/&nbsp;/gi, ' '],
  [/&amp;/gi, '&'],
  [/&lt;/gi, '<'],
  [/&gt;/gi, '>'],
  [/&#39;|&apos;/gi, "'"],
  [/&quot;/gi, '"'],
];

function cleanCueText(raw: string): string {
  let out = raw;
  for (const [pattern, replacement] of TAG_PATTERNS) out = out.replace(pattern, replacement);
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n')
    .trim();
}

function alignFromVttSettings(settings: string): CaptionCue['align'] | undefined {
  const match = /align:(start|left|center|middle|end|right)/i.exec(settings);
  if (!match) return undefined;
  const v = match[1].toLowerCase();
  if (v === 'start' || v === 'left') return 'left';
  if (v === 'end' || v === 'right') return 'right';
  return 'center';
}

/* ── Format detection ───────────────────────────────────────────── */

export function detectFormat(content: string, filename?: string): CaptionFormat {
  const head = content.slice(0, 400);
  if (/^﻿?WEBVTT/m.test(head)) return 'vtt';
  if (/\[Script Info\]|\[V4\+? Styles\]|^Dialogue:/m.test(head)) return 'ass';
  if (/-->/.test(head)) return 'srt';
  if (/^\s*[\[{]/.test(head)) return 'json';
  if (/^\d{1,2}:\d{2}:\d{2}\.\d{3},\d{1,2}:\d{2}:\d{2}\.\d{3}/m.test(head)) return 'sbv';

  const ext = filename?.split('.').pop()?.toLowerCase();
  if (ext === 'vtt' || ext === 'srt' || ext === 'ass' || ext === 'ssa' || ext === 'sbv' || ext === 'json') {
    return ext === 'ssa' ? 'ass' : (ext as CaptionFormat);
  }
  return 'srt';
}

/* ── Parsers ────────────────────────────────────────────────────── */

const normalise = (content: string): string =>
  content.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

/** SRT and WebVTT share a cue shape, so one parser covers both. */
function parseCueBlocks(content: string, warnings: string[], isVtt: boolean): CaptionCue[] {
  const cues: CaptionCue[] = [];
  const body = isVtt ? content.replace(/^WEBVTT[^\n]*\n/, '') : content;

  const blocks = body.split(/\n{2,}/);
  let index = 0;

  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length === 0) continue;

    // WebVTT metadata blocks carry no cue.
    if (isVtt && /^(NOTE|STYLE|REGION)\b/.test(lines[0])) continue;

    const arrowIdx = lines.findIndex((l) => l.includes('-->'));
    if (arrowIdx === -1) continue;

    const timeLine = lines[arrowIdx];
    const [rawStart, rest] = timeLine.split('-->');
    if (!rest) {
      warnings.push(`Skipped malformed cue near "${timeLine.slice(0, 40)}"`);
      continue;
    }

    // Everything after the end timecode is VTT positioning settings.
    const restTrimmed = rest.trim();
    const endToken = restTrimmed.split(/\s+/)[0];
    const settings = restTrimmed.slice(endToken.length);

    const startMs = parseTimecode(rawStart);
    const endMs = parseTimecode(endToken);

    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      warnings.push(`Skipped cue with unreadable timecode "${timeLine.trim().slice(0, 40)}"`);
      continue;
    }

    const text = cleanCueText(lines.slice(arrowIdx + 1).join('\n'));
    if (!text) continue;

    cues.push({
      index: ++index,
      startMs,
      endMs: Math.max(endMs, startMs + 200),
      text,
      align: isVtt ? alignFromVttSettings(settings) : undefined,
    });
  }

  return cues;
}

/** YouTube SBV: `0:00:01.000,0:00:03.500` then text lines. */
function parseSbv(content: string, warnings: string[]): CaptionCue[] {
  const cues: CaptionCue[] = [];
  const blocks = content.split(/\n{2,}/);
  let index = 0;

  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length < 2) continue;

    const [rawStart, rawEnd] = lines[0].split(',');
    if (!rawEnd) continue;

    const startMs = parseTimecode(rawStart);
    const endMs = parseTimecode(rawEnd);
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      warnings.push(`Skipped SBV cue "${lines[0].slice(0, 40)}"`);
      continue;
    }

    const text = cleanCueText(lines.slice(1).join('\n'));
    if (text) cues.push({ index: ++index, startMs, endMs: Math.max(endMs, startMs + 200), text });
  }

  return cues;
}

/** ASS/SSA: read the `[Events]` Format: line, then map each Dialogue: row. */
function parseAss(content: string, warnings: string[]): CaptionCue[] {
  const cues: CaptionCue[] = [];
  const lines = content.split('\n');

  let startCol = 1;
  let endCol = 2;
  let textCol = 9;
  let index = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^Format:/i.test(trimmed) && /Start/i.test(trimmed)) {
      const cols = trimmed.replace(/^Format:\s*/i, '').split(',').map((c) => c.trim().toLowerCase());
      const s = cols.indexOf('start');
      const e = cols.indexOf('end');
      const t = cols.indexOf('text');
      if (s >= 0) startCol = s;
      if (e >= 0) endCol = e;
      if (t >= 0) textCol = t;
      continue;
    }

    if (!/^Dialogue:/i.test(trimmed)) continue;

    // Text is always last and may itself contain commas — cap the split.
    const payload = trimmed.replace(/^Dialogue:\s*/i, '');
    const parts = payload.split(',');
    if (parts.length <= textCol) {
      warnings.push(`Skipped ASS dialogue with ${parts.length} fields`);
      continue;
    }

    const startMs = parseTimecode(parts[startCol]);
    const endMs = parseTimecode(parts[endCol]);
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue;

    const text = cleanCueText(parts.slice(textCol).join(','));
    if (text) cues.push({ index: ++index, startMs, endMs: Math.max(endMs, startMs + 200), text });
  }

  return cues;
}

/** Whisper-style JSON: `[{ start, end, text }]` with seconds or ms. */
function parseJson(content: string, warnings: string[]): CaptionCue[] {
  let data: any;
  try {
    data = JSON.parse(content);
  } catch {
    warnings.push('File is not valid JSON');
    return [];
  }

  const rows: any[] = Array.isArray(data)
    ? data
    : Array.isArray(data.segments)
      ? data.segments
      : Array.isArray(data.cues)
        ? data.cues
        : [];

  if (rows.length === 0) {
    warnings.push('No caption array found, expected a top-level array, `.segments` or `.cues`');
    return [];
  }

  // Seconds vs milliseconds is ambiguous; a max under 3 hours in "seconds"
  // that would be under 3 minutes in ms is the giveaway.
  const maxEnd = rows.reduce((m, r) => Math.max(m, Number(r.end ?? r.endMs ?? r.end_time ?? 0)), 0);
  const unitScale = maxEnd > 0 && maxEnd < 10000 ? 1000 : 1;

  return rows
    .map((r, i) => {
      const start = Number(r.start ?? r.startMs ?? r.start_time ?? 0) * unitScale;
      const end = Number(r.end ?? r.endMs ?? r.end_time ?? 0) * unitScale;
      const text = cleanCueText(String(r.text ?? r.content ?? ''));
      return { index: i + 1, startMs: Math.round(start), endMs: Math.round(end), text };
    })
    .filter((c) => c.text && c.endMs > c.startMs);
}

/* ── Public parse ───────────────────────────────────────────────── */

export function parseCaptions(content: string, filename?: string): ParseReport {
  const warnings: string[] = [];
  const text = normalise(content);
  const format = detectFormat(text, filename);

  let cues: CaptionCue[];
  switch (format) {
    case 'vtt': cues = parseCueBlocks(text, warnings, true); break;
    case 'sbv': cues = parseSbv(text, warnings); break;
    case 'ass': cues = parseAss(text, warnings); break;
    case 'json': cues = parseJson(text, warnings); break;
    case 'srt':
    default: cues = parseCueBlocks(text, warnings, false); break;
  }

  cues.sort((a, b) => a.startMs - b.startMs);

  // Overlapping cues make a caption track unreadable — clip each to the next.
  for (let i = 0; i < cues.length - 1; i++) {
    if (cues[i].endMs > cues[i + 1].startMs) {
      cues[i].endMs = cues[i + 1].startMs;
      if (cues[i].endMs - cues[i].startMs < 100) {
        warnings.push(`Cue ${cues[i].index} overlapped the next and was shortened`);
      }
    }
  }

  const cleaned = cues.filter((c) => c.endMs > c.startMs);
  if (cleaned.length === 0 && warnings.length === 0) {
    warnings.push('No readable cues found in this file');
  }

  return { format, cues: cleaned, warnings };
}

/* ── Serialisation ──────────────────────────────────────────────── */

export function serializeCaptions(cues: CaptionCue[], format: CaptionFormat = 'srt'): string {
  const sorted = [...cues].sort((a, b) => a.startMs - b.startMs);

  if (format === 'vtt') {
    const body = sorted
      .map((c, i) =>
        `${i + 1}\n${formatTimecode(c.startMs, 'vtt')} --> ${formatTimecode(c.endMs, 'vtt')}${
          c.align && c.align !== 'center' ? ` align:${c.align}` : ''
        }\n${c.text}`
      )
      .join('\n\n');
    return `WEBVTT\n\n${body}\n`;
  }

  if (format === 'json') {
    return JSON.stringify(
      sorted.map((c) => ({ start: c.startMs / 1000, end: c.endMs / 1000, text: c.text })),
      null,
      2
    );
  }

  if (format === 'ass') {
    const header = [
      '[Script Info]',
      'ScriptType: v4.00+',
      'WrapStyle: 0',
      'ScaledBorderAndShadow: yes',
      '',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      'Style: Kerf,Inter,72,&H00FFFFFF,&H00000000,&H80000000,-1,4,2,2,60,60,90,1',
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ].join('\n');

    const events = sorted
      .map(
        (c) =>
          `Dialogue: 0,${formatTimecode(c.startMs, 'ass')},${formatTimecode(c.endMs, 'ass')},Kerf,,0,0,0,,${c.text.replace(/\n/g, '\\N')}`
      )
      .join('\n');

    return `${header}\n${events}\n`;
  }

  if (format === 'sbv') {
    return sorted
      .map((c) => `${formatTimecode(c.startMs, 'sbv')},${formatTimecode(c.endMs, 'sbv')}\n${c.text}`)
      .join('\n\n') + '\n';
  }

  return sorted
    .map(
      (c, i) =>
        `${i + 1}\n${formatTimecode(c.startMs, 'srt')} --> ${formatTimecode(c.endMs, 'srt')}\n${c.text}`
    )
    .join('\n\n') + '\n';
}

/* ── Caption utilities ──────────────────────────────────────────── */

/** Split long cues so no line exceeds `maxChars` — keeps captions readable. */
export function reflowCues(cues: CaptionCue[], maxChars = 42): CaptionCue[] {
  const out: CaptionCue[] = [];

  for (const cue of cues) {
    const flat = cue.text.replace(/\n/g, ' ').trim();
    if (flat.length <= maxChars) {
      out.push({ ...cue, text: flat });
      continue;
    }

    const words = flat.split(/\s+/);
    const chunks: string[] = [];
    let current = '';

    for (const word of words) {
      if (current.length === 0) current = word;
      else if (current.length + word.length + 1 <= maxChars) current += ` ${word}`;
      else {
        chunks.push(current);
        current = word;
      }
    }
    if (current) chunks.push(current);

    // Share the cue's duration proportionally to each chunk's length.
    const total = chunks.reduce((sum, c) => sum + c.length, 0) || 1;
    const span = cue.endMs - cue.startMs;
    let cursor = cue.startMs;

    chunks.forEach((chunk, i) => {
      const share = Math.round((chunk.length / total) * span);
      const endMs = i === chunks.length - 1 ? cue.endMs : cursor + share;
      out.push({ index: out.length + 1, startMs: cursor, endMs, text: chunk });
      cursor = endMs;
    });
  }

  return out.map((c, i) => ({ ...c, index: i + 1 }));
}

/**
 * Break one caption into at most two balanced lines.
 *
 * Subtitles are read in a glance, and the thing that ruins that is line
 * length: a caption running the width of the frame makes the eye
 * traverse the whole picture and lose the shot. Broadcast practice is
 * roughly 42 characters a line and never more than two lines, and it is
 * practice for a reason.
 *
 * BALANCED rather than greedy. Filling the first line to the limit and
 * dropping the remainder onto the second produces the shape everybody
 * recognises as amateur: a long line with two words under it. Splitting
 * at the word boundary closest to the middle gives two lines of similar
 * length, which is what reads as typeset rather than wrapped.
 *
 * Longer than two lines is not wrapped here: `reflowCues` splits it into
 * consecutive cues first, because four lines on screen is a wall of
 * text however it is broken.
 */
export function balanceLines(text: string, maxChars = 40): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= maxChars) return flat;

  const words = flat.split(' ');
  if (words.length < 2) return flat;

  /* The break that leaves the two halves closest in length. Measured on
     the joined strings rather than on word counts, because one long word
     is worth several short ones to the eye. */
  let bestAt = 1;
  let bestCost = Infinity;
  for (let at = 1; at < words.length; at += 1) {
    const first = words.slice(0, at).join(' ').length;
    const second = words.slice(at).join(' ').length;
    const cost = Math.abs(first - second);
    if (cost < bestCost) { bestCost = cost; bestAt = at; }
  }
  return `${words.slice(0, bestAt).join(' ')}\n${words.slice(bestAt).join(' ')}`;
}

/** Shift every cue by `offsetMs` (sync fix for out-of-step subtitle files). */
export function shiftCues(cues: CaptionCue[], offsetMs: number): CaptionCue[] {
  return cues.map((c) => ({
    ...c,
    startMs: Math.max(0, c.startMs + offsetMs),
    endMs: Math.max(200, c.endMs + offsetMs),
  }));
}

/** Rescale cue timing, e.g. converting a 23.976fps file to 25fps. */
export function rescaleCues(cues: CaptionCue[], factor: number): CaptionCue[] {
  return cues.map((c) => ({
    ...c,
    startMs: Math.round(c.startMs * factor),
    endMs: Math.round(c.endMs * factor),
  }));
}
