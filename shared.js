// Helpers shared by every extension context (side panel, content scripts, service
// worker). Loaded as a plain script before the files that use it.

function amTodayKey(d = new Date()) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// Consecutive done-days ending today — or yesterday, so an unfinished today doesn't
// read as a broken streak mid-day.
function amStreakFrom(history) {
  const h = history || {};
  let streak = 0;
  const d = new Date();
  if (!h[amTodayKey(d)]) d.setDate(d.getDate() - 1);
  while (h[amTodayKey(d)]) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

// Extract a daily solve target from free-text goals like "2 DSA camp modules" or
// "1 more quesition from the trees module". A bare /\d+/ turned "finish LeetCode 704"
// into a target of 704, so a number only counts when it's small (1-30) and sits near
// a goal-ish keyword ("quesition" kept deliberately — real typo in real goals).
const AM_GOAL_WORDS =
  "(?:problems?|questions?|quesitions?|qs?|solves?|modules?|mediums?|easys?|easies|hards?|more|today|per\\s*day)";

function amGoalTarget(goalText) {
  const text = String(goalText || "");
  const m =
    // "2 problems", "1 more quesition", "2 DSA camp modules" (≤3 words between)
    text.match(new RegExp(`\\b(\\d{1,2})\\b(?:\\s+\\S+){0,3}?\\s+\\b${AM_GOAL_WORDS}\\b`, "i")) ||
    // "problems: 2", "solve 2"
    text.match(new RegExp(`\\b${AM_GOAL_WORDS}\\b\\s*[:\\-]?\\s*\\b(\\d{1,2})\\b`, "i"));
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 1 && n <= 30 ? n : null;
}
