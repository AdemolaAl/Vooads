// Ban Shield: flags phrases that ad platforms often reject, and suggests safer wording.
// It lowers rejection risk. It never guarantees approval.
const RULES = [
  { re: /guarantee(d|s)?\s+(profit|profits|income|returns?|wins?|results?|weight loss)/gi, w: 30, why: 'Promises a result.', fix: 'results vary' },
  { re: /risk[- ]?free/gi, w: 25, why: 'Claims there is no risk.', fix: 'with clear risk controls' },
  { re: /double your (money|deposit|cash|income)/gi, w: 25, why: 'Unrealistic money claim.', fix: 'grow your skills' },
  { re: /(make|earn)\s+[$€£₦₹]?\d[\d,.]*\s*(k|dollars|euros|pounds|naira|usd)?\s*(a|per|every)\s+(day|week|month)/gi, w: 25, why: 'Specific income claim.', fix: 'learn at your own pace' },
  { re: /\b(are you|you're|you are)\s+(broke|poor|in debt|fat|overweight|ugly|depressed|struggling)/gi, w: 22, why: 'Points at the viewer\'s personal traits. Ad platforms reject this.', fix: 'Looking for something new?' },
  { re: /get rich( quick)?/gi, w: 25, why: 'Get-rich-quick claim.', fix: 'build your knowledge' },
  { re: /100%\s*(win|sure|accurate|guaranteed|effective|natural cure)/gi, w: 25, why: 'Certainty claim.', fix: 'carefully made' },
  { re: /sure (odds|win|bet|money)/gi, w: 25, why: 'Certainty claim on betting.', fix: "today's odds" },
  { re: /(lose|lost)\s+\d+\s*(kg|kilos|lbs|pounds)\s+in\s+\d+\s*(days?|weeks?)/gi, w: 25, why: 'Fast weight-loss claim.', fix: 'feel lighter with a routine you can keep' },
  { re: /\b(cures?|heals?|treats?)\s+(cancer|diabetes|covid|hiv|acne forever|anxiety|depression)/gi, w: 30, why: 'Medical claim.', fix: 'supports your routine' },
  { re: /(quit your job|financial freedom|passive income guaranteed)/gi, w: 12, why: 'Lifestyle income claim.', fix: 'learn a new skill' },
  { re: /withdraw (instantly|daily|every day)/gi, w: 10, why: 'Payout promise draws extra review.', fix: 'simple withdrawals' },
  { re: /\b(fda|who|government)[- ]approved\b/gi, w: 18, why: 'Approval claims need proof.', fix: 'quality tested' },
  { re: /(click here|link in bio) to claim your (prize|reward|money)/gi, w: 20, why: 'Looks like a giveaway scam.', fix: 'see the offer' },
  { re: /,?\s*\b(100%\s*)?guaranteed?\b(?!\s+(profit|profits|income|returns?|wins?|results?|weight loss))!?/gi, w: 15, why: 'Guarantees draw extra review, and most ad platforms reject them.', fix: '.' },
  { re: /\b(are you|you're|you are|feeling)\s+(embarrassed|ashamed|insecure|self-conscious|tired of being \w+)(\s+(by|of|about)\s+your\s+\w+)?\??/gi, w: 22, why: 'Points at the viewer\'s body or feelings. Ad platforms reject this.', fix: 'If this sounds like you too…' },
  { re: /\b(doctors|dentists|banks|experts) hate (this|him|her|them)( one)?( weird)?( trick)?\.?/gi, w: 18, why: 'Clickbait phrasing that platforms treat as misleading.', fix: 'Here is what worked for me.' },
  { re: /\b(miracle|magic) (cure|pill|product|serum|formula)\b/gi, w: 18, why: 'Miracle claims are treated as misleading.', fix: 'my everyday favourite' },
  { re: /\bbefore\s*(and|&)\s*after\b/gi, w: 8, why: 'Before/after framing is restricted for health and beauty on some platforms.', fix: 'my routine' },
];

function scan(text, niche = 'general') {
  let score = 100;
  const flags = [];
  for (const r of RULES) {
    const m = String(text || '').match(r.re);
    if (m) m.forEach((phrase) => { score -= r.w; flags.push({ phrase: phrase.replace(/^[,\s]+/, ''), why: r.why, fix: r.fix === '.' ? 'Remove the guarantee' : r.fix, severity: r.w >= 20 ? 'high' : 'medium' }); });
  }
  if (niche === 'betting' && !/18\+/.test(text)) { score -= 15; flags.push({ phrase: 'No age notice', why: 'Gambling ads need an 18+ notice and the platform\'s written permission.', fix: 'Add "18+. Play responsibly."', severity: 'medium' }); }
  if (niche === 'finance' && !/risk/i.test(text)) { score -= 6; flags.push({ phrase: 'No risk notice', why: 'Financial ads review better with a short risk line.', fix: 'Add "Capital at risk."', severity: 'medium' }); }
  score = Math.max(0, Math.min(100, score));
  return { score, level: score >= 80 ? 'low' : score >= 50 ? 'review' : 'high', flags };
}

function rewrite(text, niche = 'general') {
  let t = String(text || '');
  RULES.forEach((r) => { t = t.replace(r.re, r.fix); });
  t = t.replace(/\s+([,.!?])/g, '$1').replace(/^[,\s]+/, '').replace(/\s{2,}/g, ' ').replace(/!{2,}/g, '!').trim();
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (niche === 'betting' && !/18\+/.test(t)) t += ' 18+. Play responsibly.';
  if (niche === 'finance' && !/risk/i.test(t)) t += ' Capital at risk.';
  return t;
}

module.exports = { scan, rewrite };
