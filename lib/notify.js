// Optional: tell n8n a new attempt is waiting for review, so a coach gets a
// Telegram / email / WhatsApp ping. Never sends the rating.

export async function notifyAttempt({ attempt, puzzle, studentName }, env = process.env) {
  const url = env.N8N_WEBHOOK_URL;
  if (!url) return;
  const payload = {
    event: 'attempt_submitted',
    student: studentName,
    puzzle_id: attempt.puzzle_id,
    difficulty: puzzle ? Number(puzzle.difficulty) || null : null,
    provisional_grade: attempt.auto_grade,
    reason: attempt.auto_reason,
    line: attempt.line,
    objective: attempt.objective,
    hint_used: attempt.hint_used === 'TRUE' || attempt.hint_used === true,
    self_called_wrong: attempt.self_called_wrong === 'TRUE' || attempt.self_called_wrong === true,
    finished_at: attempt.finished_at,
    review_url: env.APP_URL ? `${env.APP_URL.replace(/\/$/, '')}/#queue` : null,
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
  } catch (err) {
    console.warn('n8n webhook failed:', err.message);
  } finally {
    clearTimeout(timer);
  }
}
