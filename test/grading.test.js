import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoGrade, tokenise, normaliseMove } from '../lib/grading.js';

test('normalises notation differences', () => {
  assert.deepEqual(tokenise('1. Nxf7+ Kxf7 2. Qh5+ Kg8 3. Qd5#'), ['Nf7', 'Kf7', 'Qh5', 'Kg8', 'Qd5']);
  assert.deepEqual(tokenise('1...Rxe1+ 2.Kh2'), ['Re1', 'Kh2']);
  assert.equal(normaliseMove('0-0-0'), 'O-O-O');
  assert.equal(normaliseMove('O-O+'), 'O-O');
  assert.equal(normaliseMove('exd8=Q+'), 'ed8Q');
  assert.equal(normaliseMove('e8q'), 'e8Q');
  assert.equal(normaliseMove('nf3'), 'Nf3');
  assert.equal(normaliseMove('bxc3'), 'bc3', 'b-file pawn stays lower-case');
  assert.equal(normaliseMove('♘f3'), 'Nf3');
  assert.equal(normaliseMove('Qh5!?'), 'Qh5');
});

test('auto-grade: full, partial, wrong', () => {
  const key = 'Nxf7+ Kxf7 Qh5+ Kg8 Qd5#';
  assert.equal(autoGrade('1.Nxf7+ Kxf7 2.Qh5+ Kg8 3.Qd5#', key).grade, 'full');
  assert.equal(autoGrade('Nxf7 Kxf7 Qh5 Kg8 Qd5 Kh8', key).grade, 'full', 'extra moves beyond the key are fine');
  assert.equal(autoGrade('Nxf7 Kxf7 Qf3', key).grade, 'partial');
  assert.equal(autoGrade('Nxf7', key).grade, 'partial', 'incomplete line → partial');
  assert.equal(autoGrade('Qh5 g6', key).grade, 'wrong');
  assert.equal(autoGrade('', key).grade, 'wrong');
});

test('auto-grade accepts alternatives separated by |', () => {
  const key = 'Qh5 g6 Qxe5 | Qh5 Nf6 Qxf7#';
  assert.equal(autoGrade('Qh5 Nf6 Qxf7#', key).grade, 'full');
  assert.equal(autoGrade('Qh5 Nc6 Bc4', key).grade, 'partial');
});

test('no answer key → partial for the coach to grade', () => {
  assert.equal(autoGrade('Nf3', '').grade, 'partial');
});
