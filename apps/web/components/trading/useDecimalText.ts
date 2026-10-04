'use client';

import { useEffect, useState } from 'react';

/**
 * Text state for an amount box whose value is stored in raw units (2026-10-04 audit): the box
 * used to re-render from the raw number on every keystroke, so a trailing "." vanished ("2." →
 * "2", so $2.50 couldn't be typed) and a lone "." became the amount "NaN". Typed text is kept
 * as typed; only a valid number reaches `onChange`, rounded to `decimals`. Outside changes to
 * `valueRaw` (a preset, Max, a side switch) replace the text.
 */
export function useDecimalText(valueRaw: string, decimals: number, onChange: (raw: string) => void) {
  const scale = 10 ** decimals;
  const display = (raw: string) => (raw ? (Number(raw) / scale).toString() : '');
  const [text, setText] = useState(() => display(valueRaw));

  useEffect(() => {
    const typedRaw = text === '' || !Number.isFinite(Number(text)) ? '' : Math.round(Number(text) * scale).toString();
    if (typedRaw !== valueRaw) setText(display(valueRaw));
    // Only an outside change of the value should overwrite what's being typed.
  }, [valueRaw]); // eslint-disable-line react-hooks/exhaustive-deps

  const onTextChange = (raw: string) => {
    const pattern = new RegExp(`^[0-9]*[.]?[0-9]{0,${decimals}}$`);
    if (raw !== '' && !pattern.test(raw)) return; // no "-", letters, or more decimals than the token has
    setText(raw);
    const n = Number(raw);
    onChange(raw === '' || raw === '.' || !Number.isFinite(n) || n <= 0 ? '' : Math.round(n * scale).toString());
  };

  return [text, onTextChange] as const;
}
