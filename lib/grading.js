// Auto-check of a written line against the book's answer key.
//
// This compares move TEXT only. It has no board, so it cannot recognise a valid
// alternative the book doesn't list — the coach review exists for that.
// The answer key may hold alternatives separated by "|":  "Qh5 g6 Qxe5 | Qh5 Nf6 Qxf7#"

const FIGURINES = { '♔': 'K', '♕': 'Q', '♖': 'R', '♗': 'B', '♘': 'N', '♚': 'K', '♛': 'Q', '♜': 'R', '♝': 'B', '♞': 'N', '♙': '', '♟': '' };

export function normaliseMove(raw) {
  let t = String(raw).trim();
  if (!t) return '';
  t = t.replace(/[♔♕♖♗♘♚♛♜♝♞♙♟]/g, (c) => FIGURINES[c]);
  t = t.replace(/e\.?p\.?$/i, '');
  t = t.replace(/[+#!?x×:=()]/g, '');
  t = t.replace(/0/g, 'O');
  if (/^O-?O-?O$/i.test(t)) return 'O-O-O';
  if (/^O-?O$/i.test(t)) return 'O-O';
  // k, q, r, n are never file letters, so a lower-case first letter is safe to upper-case.
  // (b is skipped: "bc3" could be a pawn capture from the b-file.)
  t = t.replace(/^[kqrn](?=[a-h1-8])/, (c) => c.toUpperCase());
  // Promotion piece: e8q / ed8q → e8Q / ed8Q
  t = t.replace(/^([a-h]?[a-h][18])([qrbn])$/i, (_, sq, p) => sq + p.toUpperCase());
  return t;
}

export function tokenise(line) {
  if (!line) return [];
  return String(line)
    .replace(/\d+\s*\.+/g, ' ') // move numbers: "1." "1..." "12 ..."
    .replace(/…/g, ' ')
    .split(/[\s,;]+/)
    .map(normaliseMove)
    .filter((t) => t && t !== '-' && !/^(1-0|0-1|½-½|1\/2-1\/2|O-1|1-O)$/.test(t));
}

export function answerLines(answer) {
  return String(answer || '')
    .split('|')
    .map(tokenise)
    .filter((l) => l.length > 0);
}

/**
 * @returns {{ grade: 'full'|'partial'|'wrong', firstMove: boolean, fullLine: boolean, reason: string }}
 */
export function autoGrade(line, answer) {
  const student = tokenise(line);
  const keys = answerLines(answer);
  if (keys.length === 0) {
    return { grade: 'partial', firstMove: false, fullLine: false, reason: 'No answer key for this puzzle — coach to grade.' };
  }
  if (student.length === 0) {
    return { grade: 'wrong', firstMove: false, fullLine: false, reason: 'No moves entered.' };
  }
  const fullLine = keys.some((k) => student.length >= k.length && k.every((m, i) => student[i] === m));
  if (fullLine) return { grade: 'full', firstMove: true, fullLine: true, reason: 'Whole main line matches the book.' };
  const firstMove = keys.some((k) => k[0] === student[0]);
  if (firstMove) return { grade: 'partial', firstMove: true, fullLine: false, reason: 'First move matches; the line differs from the book later.' };
  return { grade: 'wrong', firstMove: false, fullLine: false, reason: 'First move does not match the book.' };
}

export const SCORE = { full: 1, partial: 0.5, wrong: 0 };

/** Final grade after the hint cap (hint taken caps the result at 0.5). */
export function effectiveGrade(grade, hintUsed) {
  if (!SCORE.hasOwnProperty(grade)) return null;
  if (hintUsed && grade === 'full') return 'partial';
  return grade;
}
