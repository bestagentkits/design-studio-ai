/** Linear-state pattern matcher; unsupported ECMAScript syntax is rejected, never reinterpreted. */
export function compileConnectorPattern(pattern: string, unsupported: (message: string) => never, step: () => void) {
  if (pattern.length > 256) unsupported('Patterns are limited to 256 UTF-16 code units.');
  const chars = [...pattern]; let index = 0;
  const anchoredStart = chars[0] === '^'; if (anchoredStart) index++;
  let anchoredEnd = false;
  type Atom = (value: string) => boolean;
  type Token = { atom: Atom; min: number; max: number };
  const tokens: Token[] = [];
  const space = (value: string) => '\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'.includes(value);
  function unit(inClass = false): { atom: Atom; literal?: string } {
    const value = chars[index++];
    if (value === undefined) return unsupported('Incomplete pattern.');
    if (value !== '\\') return { atom: char => char === value, literal: value };
    const escaped = chars[index++];
    if (escaped === undefined) return unsupported('Incomplete escape.');
    const digit = (char: string) => char >= '0' && char <= '9';
    const word = (char: string) => digit(char) || char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char === '_';
    const classes: Record<string, Atom> = { d: digit, D: char => !digit(char), w: word, W: char => !word(char), s: space, S: char => !space(char) };
    if (classes[escaped]) return { atom: classes[escaped] };
    const controls: Record<string, string> = { n: '\n', r: '\r', t: '\t', f: '\f', v: '\v' };
    if (controls[escaped]) return { atom: char => char === controls[escaped], literal: controls[escaped] };
    if (escaped === '-' && !inClass) return unsupported('Escaped hyphen requires a character class.');
    if (!'^$\\.*+?()[]{}|/-'.includes(escaped)) return unsupported('Unsupported pattern escape.');
    return { atom: char => char === escaped, literal: escaped };
  }
  while (index < chars.length) {
    if (chars[index] === '$' && index === chars.length - 1) { anchoredEnd = true; index++; break; }
    let atom: Atom;
    if (chars[index] === '[') {
      index++; const negate = chars[index] === '^'; if (negate) index++;
      const members: Atom[] = [];
      while (index < chars.length && chars[index] !== ']') {
        const from = unit(true);
        if (chars[index] === '-' && chars[index + 1] !== ']' && chars[index + 1] !== undefined) {
          index++; const to = unit(true);
          if (from.literal === undefined || to.literal === undefined || from.literal.codePointAt(0)! > to.literal.codePointAt(0)!) unsupported('Unsupported character range.');
          members.push(char => char.codePointAt(0)! >= from.literal!.codePointAt(0)! && char.codePointAt(0)! <= to.literal!.codePointAt(0)!);
        } else members.push(from.atom);
      }
      if (chars[index++] !== ']') unsupported('Unclosed character class.');
      atom = char => { let found = false; for (const member of members) { step(); if (member(char)) { found = true; break; } } return negate ? !found : found; };
    } else if (chars[index] === '.') { index++; atom = char => !'\n\r\u2028\u2029'.includes(char); }
    else {
      if ('^$*+?(){}|]'.includes(chars[index])) unsupported('Groups, alternation, assertions and misplaced quantifiers are unsupported.');
      atom = unit().atom;
    }
    let min = 1, max = 1;
    if (chars[index] === '*') { min = 0; max = Infinity; index++; }
    else if (chars[index] === '+') { max = Infinity; index++; }
    else if (chars[index] === '?') { min = 0; index++; }
    else if (chars[index] === '{') {
      const end = chars.indexOf('}', index), value = chars.slice(index + 1, end).join('');
      if (end < 0 || !/^\d{1,3}(,\d{0,3})?$/.test(value)) unsupported('Unsupported repetition bound.');
      const parts = value.split(','); min = Number(parts[0]); max = parts.length === 1 ? min : parts[1] === '' ? Infinity : Number(parts[1]);
      if (max < min || min > 256 || max !== Infinity && max > 256) unsupported('Repetition bounds must be at most 256.');
      index = end + 1;
    }
    tokens.push({ atom, min, max });
  }
  // Expand bounded counts into an epsilon NFA. Each transition consumes one character or moves forward.
  type State = { atom?: Atom; next?: number; epsilon: number[] };
  const states: State[] = [{ epsilon: [] }]; let tail = 0;
  for (const token of tokens) {
    for (let count = 0; count < (token.max === Infinity ? token.min : token.max); count++) {
      const next = states.length; states.push({ epsilon: [] }); states[tail].atom = token.atom; states[tail].next = next;
      if (count >= token.min) states[tail].epsilon.push(next); tail = next;
      if (states.length > 1024) unsupported('Pattern state limit exceeded.');
    }
    if (token.max === Infinity) {
      const next = states.length; states.push({ epsilon: [] }); states[tail].atom = token.atom; states[tail].next = tail; states[tail].epsilon.push(next); tail = next;
    }
  }
  const accept = tail;
  function closure(input: Set<number>) {
    const pending = [...input]; while (pending.length) { const current = pending.pop()!; step(); for (const next of states[current].epsilon) if (!input.has(next)) { input.add(next); pending.push(next); } } return input;
  }
  return (value: string) => {
    let active = closure(new Set([0]));
    if (!anchoredEnd && active.has(accept)) return true;
    for (const char of value) {
      const next = new Set<number>();
      for (const current of active) { step(); const state = states[current]; if (state.atom?.(char)) next.add(state.next!); }
      if (!anchoredStart) next.add(0);
      active = closure(next); if (!anchoredEnd && active.has(accept)) return true;
    }
    return active.has(accept);
  };
}
