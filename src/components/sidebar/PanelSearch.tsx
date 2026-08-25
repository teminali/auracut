/* ═══════════════════════════════════════════════════════════════════
   The search bar every asset panel gets.

   Media and Effects each had their own, built inline and worded
   slightly differently; Transitions, Filters, Text and Audio had none
   at all, so finding "whip pan" among fourteen transitions meant
   reading all fourteen. One component, so the bar is in the same place
   with the same behaviour whichever tab you are on.
   ═══════════════════════════════════════════════════════════════════ */

import React from 'react';
import { Search, X } from 'lucide-react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** What is being searched, e.g. "transitions". */
  noun: string;
  /** Shown on the right when there is a query — "3 of 14". */
  countLabel?: string;
  autoFocus?: boolean;
}

export const PanelSearch: React.FC<Props> = ({ value, onChange, noun, countLabel, autoFocus }) => (
  <div className="pro-input flex items-center gap-1.5 px-2 h-7">
    <Search className="w-3 h-3 text-spectrum-textDim flex-shrink-0" />
    <input
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      // Escape clears rather than closing the panel — the reflex when a
      // search has narrowed things too far is to widen it again.
      onKeyDown={(e) => {
        if (e.key === 'Escape' && value) {
          e.stopPropagation();
          onChange('');
        }
      }}
      placeholder={`Search ${noun}…`}
      className="flex-1 bg-transparent outline-none text-[11px] text-spectrum-text placeholder:text-spectrum-textFaint min-w-0"
    />
    {value && countLabel && (
      <span className="text-[9px] font-mono text-spectrum-textFaint tabular flex-shrink-0">{countLabel}</span>
    )}
    {value && (
      <button
        onClick={() => onChange('')}
        className="w-3.5 h-3.5 flex items-center justify-center text-spectrum-textDim hover:text-spectrum-text flex-shrink-0"
        title="Clear (Esc)"
      >
        <X className="w-3 h-3" />
      </button>
    )}
  </div>
);

/**
 * Does this item match the query?
 *
 * Splits on whitespace and requires every word, so "blur dis" finds
 * "Blur Dissolve" — an exact-substring test would not, and that is
 * exactly how people type when they half-remember a name.
 */
export function matchesQuery(query: string, ...fields: (string | undefined)[]): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  const haystack = fields.filter(Boolean).join(' ').toLowerCase().replace(/[_\-.]+/g, ' ');
  return needle.split(/\s+/).every((word) => haystack.includes(word));
}
