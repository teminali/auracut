import React from 'react';

/* ═══════════════════════════════════════════════════════════════════
   Minimal markdown

   Agents write markdown whether or not you ask them to, and a reply full
   of literal ** and ` characters reads as broken output. This handles the
   three things that actually show up in practice — bold, inline code and
   bullet lines — and deliberately nothing else: no links, no HTML, no
   dangerouslySetInnerHTML, so model output can never inject markup.
   ═══════════════════════════════════════════════════════════════════ */

export const RichText: React.FC<{ text: string }> = ({ text }) => (
  <div className="whitespace-pre-wrap break-words">
    {text.split('\n').map((line, i) => {
      const bullet = /^\s*[•*-]\s+/.test(line);
      const body = bullet ? line.replace(/^\s*[•*-]\s+/, '') : line;
      return (
        <div key={i} className={bullet ? 'flex gap-1.5 pl-0.5' : undefined}>
          {bullet && <span className="text-spectrum-textDim flex-shrink-0">•</span>}
          <span className="min-w-0">{renderInline(body)}</span>
        </div>
      );
    })}
  </div>
);

/** Split on **bold** and `code`, keeping the delimiters out of the output. */
function renderInline(line: string): React.ReactNode[] {
  return line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="font-mono text-[11px] px-1 py-px rounded-[3px] bg-black/30 text-spectrum-accent">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

