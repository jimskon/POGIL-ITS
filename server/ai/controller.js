// server/ai/controller.js
const OpenAI = require('openai');
require('dotenv').config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'; // keep model configurable

// ---------- Policy helpers driven by activity guidance ----------
function stripHtml(s = '') {
  return String(s)
    .replace(/<br\s*\/?>/gi, '\n')       // keep <br> → newline
    .replace(/<\/?[A-Za-z!][^>]*>/g, ''); // strip only real tags, not "< 1" or "> 10"
}


const noFollowups = (s) => /^\s*(none|no\s*follow-?ups?|no\s*feedback)\s*$/i
  .test(String(s || '').trim());

const isNone = s => /^\s*none\s*$/i.test(String(s || '').trim());

const FATAL_PATTERNS = [
  /Traceback/i, /SyntaxError/i, /NameError/i, /TypeError/i, /ZeroDivisionError/i,
  /\bruntimeerror\b/i, /\binfinite loop\b/i, /\bwon'?t run\b/i, /\bdoes not run\b/i
];

function isFatal(text) {
  const t = String(text || '').trim();
  return !!t && FATAL_PATTERNS.some(r => r.test(t));
}

const SOFT_PATTERNS = [
  /\bremember\b/i, /\btip:?\b/i, /\bconsider\b/i, /\byou might\b/i, /\bnote that\b/i,
  /\bstyle\b/i, /\bnaming\b/i, /\bformat(ting)?\b/i, /\bspacing\b/i,
  /uppercase.*lowercase/i, /\brefactor\b/i, /\boptimi[sz]e\b/i, /\bextra feature\b/i
];

function detectLangFromCode(src = "") {
  const s = String(src).trim();
  if (!s) return null;

  // Very lightweight heuristics
  if (/\b#include\s*<[^>]+>/.test(s) || /\bint\s+main\s*\(/.test(s) || /std::(cout|cin|string)/.test(s)) {
    return "cpp";
  }
  if (/\bdef\s+\w+\s*\(/.test(s) || /\bprint\s*\(/.test(s) || /^\s*#/.test(s)) {
    return "python";
  }
  return null;
}

function isSoft(text) {
  const t = String(text || '').trim();
  return !t || SOFT_PATTERNS.some(r => r.test(t));
}

const GIBBERISH_PATTERNS = [
  /^\s*$/,                                   // empty
  /^(idk|i don'?t know|dunno|n\/a)\s*$/i,    // no-attempt
  /^[^a-zA-Z0-9]{3,}$/,                      // punctuation garbage
  /^[a-z]{1,2}\s*$/i                         // ultra-short tokens
];

// Allow short but meaningful “True/False”, numbers, simple ops
function looksGibberish(ans) {
  const a = String(ans || '').trim();
  if (GIBBERISH_PATTERNS.some(r => r.test(a))) return true;
  if (/^(true|false)$/i.test(a)) return false;
  if (/^[\d\s.+\-*/%()=<>!]+$/.test(a)) return false;
  return a.length < 2;
}


// Parse the free-text \aicodeguidance into flags
function derivePolicyFromGuidance(guidanceText = '') {
  const g = stripHtml(guidanceText).toLowerCase().trim();

  // Treat a bare "none" (or synonyms) as "no follow-ups"
  if (/^(none|no\s*follow-?ups?|no\s*follow\s*ups?)$/.test(g)) {
    return {
      followupGate: 'none',
      // These flags should NOT read from g here—just default them.
      requirementsOnly: false,
      ignoreSpacing: false,
      forbidFStrings: false,
      failOpen: false,
      noExtras: false,
    };
  }
  //const g = stripHtml(guidanceText).toLowerCase();
  const explicitFU = (g.match(/follow[-\s]*ups?\s*:\s*(none|gibberish-only|default)/i) || [])[1];
  const noFollowups = /do not ask a follow up/.test(g);
  const requirementsOnly = /requirements-only/.test(g);
  const ignoreSpacing = /ignore spacing/.test(g);
  const forbidFStrings = /f-strings.*(unavailable|do not|don't)/.test(g);
  const failOpen = /fail[- ]open/.test(g) || /doesn'?t have to be perfect/.test(g);
  const noExtras = /do not require extra features|do not require extras/.test(g);

  // If not explicitly “no followups”, default to gibberish-only followups when requirements-only/fail-open vibe is present.
  // Prefer "default" unless explicitly set to "none".
  const followupGate = explicitFU
    ? explicitFU.toLowerCase()
    : (noFollowups ? 'none' : 'default');

  return {
    followupGate,           // 'none' | 'gibberish-only' | 'default'
    requirementsOnly,
    ignoreSpacing,
    forbidFStrings,
    failOpen,
    noExtras
  };
}

const VALUE_TWEAK_PATTERNS = [
  // Direct “change/adjust/set/use/pick/choose … <var> …”
  /\b(?:change|adjust|modify|set|pick|choose|use)\b[^.?!]{0,80}\b(?:value|variable|number|input|cost|time|weight|max(?:Time|Cost)?)\b/i,

  // “make/ensure … less than / greater than / < / > / == …”
  /\b(?:make|ensure)\b[^.?!]{0,80}\b(?:less than|greater than|<=|>=|<|>|equal(?:s)?(?: to)?)\b/i,

  // “should be/use/set … <number or relational> …”
  /\bshould\s+(?:be|use|set)\b[^.?!]{0,80}\b(?:\d+(?:\.\d+)?|less than|greater than|<=|>=|<|>|equal(?:s)?(?: to)?)\b/i,

  // “should be 33 instead of 31”
  /\bshould\s+be\s+\d+(?:\.\d+)?\b[^.?!]{0,60}\binstead of\b[^.?!]{0,60}\d+(?:\.\d+)?\b/i,

  // “so that / to make it true/false”
  /\b(?:so that|to make)\s+it\s+(?:true|false)\b/i,
];


function mentionsValueTweak(s) {
  const t = String(s || '').trim();
  return !!t && VALUE_TWEAK_PATTERNS.some(r => r.test(t));
}

function codeLooksGibberish(src) {
  const s = String(src || '').trim();
  if (!s) return true;                         // empty
  if (/^[#\s;{}()[\]]+$/.test(s)) return true; // only punctuation/whitespace
  // If it has no comparisons and no boolean ops, it's probably not addressing the task.
  if (!/[<>=!]=?|<=|>=/.test(s) && !/\b(and|or|not)\b/i.test(s)) return true;
  return false;
}

async function evaluateStudentResponse(req, res) {
  const {
    questionText,
    studentAnswer,
    sampleResponse = "",
    feedbackPrompt = "",
    followupPrompt = "",
    forceFollowup = false,
    context = {},
    guidance = "",
    codeContext = ""        // 👈 NEW: optional code shown with the question
  } = req.body || {};

  if (String(feedbackPrompt).trim().toLowerCase() === "none") {
    return res.status(200).json({ feedback: null, followup: null, verdict: "minor" });
  }
  const qp = String(feedbackPrompt || '').trim().toLowerCase();
  if (/^(none|no\s*follow-?ups?|no\s*follow\s*ups?)$/.test(qp) && !forceFollowup) {
    return res.status(200).json({ followupQuestion: null, meta: { reason: 'policy_no_followups' } });
  }
  if (!questionText || studentAnswer == null) {
    return res.status(200).json({ followupQuestion: null, meta: { reason: 'missing_fields' } });
  }

  try {
    const activityGuide = stripHtml(guidance || '');
    const questionGuide = stripHtml(feedbackPrompt || '');
    const policy = getEffectivePolicy(activityGuide, questionGuide);

    // Respect explicit "no follow-ups"
    if (policy.followupGate === 'none' && !forceFollowup) {
      return res.status(200).json({ followupQuestion: null, meta: { reason: 'policy_no_followups' } });
    }

    // 🔎 Let the model judge coherence, relevance, wrong, overly simple, missing artifact.
    //    (No early return on "gibberish-only".)
    const sys = [
      'You are a concise, supportive grading assistant for an intro programming class.',
      'Judge answers by whether they are coherent, on-topic, and meet the prompt’s intent.',
      'Accept partial/approximate answers that show understanding.',
      'Ask at most ONE follow-up only when the answer is incoherent, off-prompt, clearly wrong overall, overly simple for the task, or missing a required artifact (e.g., pasted output/tests).',
      'No nitpicks about style/naming/spacing/performance. Ignore extra features.',
      questionGuide ? `Per-question guidance (do not quote): ${questionGuide}` : '',
      activityGuide ? `Activity guidance (do not quote): ${activityGuide}` : '',
      'Return ONLY the JSON per the schema.',
    ].filter(Boolean).join('\n');

    const schema = `Return JSON only:
{"decision":"accept"|"followup","reason":"incoherent"|"off_prompt"|"wrong"|"overly_simple"|"missing_artifact","followup":null|string,"confidence":number}`;

    const user = [
      `Question: ${stripHtml(questionText)}`,
      codeContext ? `Shown code:\n${stripHtml(codeContext)}` : '',
      sampleResponse ? `Reference (optional): ${stripHtml(sampleResponse)}` : '',
      `Student's submission:\n${stripHtml(studentAnswer)}`,
      '',
      schema,
      forceFollowup ? 'If uncertain, prefer "followup".' : 'If reasonable, prefer "accept".',
      'Follow-up must be ≤2 short sentences and encouraging/actionable.',
      'For “paste outputs/tests” prompts, require actual console output from multiple runs if the prompt asks.',
    ].join('\n');

    const chat = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
      max_tokens: 180,
    });

    const raw = (chat.choices?.[0]?.message?.content ?? '').trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    let obj;
    try {
      obj = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(raw);
    } catch {
      return res.status(200).json({ followupQuestion: null, meta: { reason: 'unparsable' } });
    }

    const decision = String(obj.decision || '').toLowerCase();
    let question = obj.followup ? String(obj.followup).trim() : null;
    const reason = obj.reason || '';

    // Suppress “change the input value” nags if your guides say not to
    const forbidValueNags =
      /\bjudge\b.*\blogic\b.*\bnot\b.*\b(true|false|result)\b/i.test(`${questionGuide} ${activityGuide}`) ||
      /\bdo not ask\b.*\bchange\b.*\bvalues?\b/i.test(`${questionGuide} ${activityGuide}`);
    if (forbidValueNags && question && mentionsValueTweak(question)) {
      question = null;
    }

    // Drop soft, nudge-y fluff
    if (isSoft(question) && !isFatal(question)) question = null;

    if (decision !== 'followup' || !question) {
      return res.status(200).json({ followupQuestion: null, meta: { reason: 'accepted' } });
    }

    // Keep it short (≤25 words) and end at the first '?'
    const qIdx = question.indexOf('?');
    if (qIdx >= 0) question = question.slice(0, qIdx + 1);
    const words = question.split(/\s+/);
    if (words.length > 25) question = words.slice(0, 25).join(' ') + '?';

    return res.status(200).json({ followupQuestion: question, meta: { reason } });
  } catch (err) {
    console.error('❌ OpenAI evaluate-response failed:', err);
    return res.status(200).json({ followupQuestion: null, meta: { reason: 'ai_unavailable' } });
  }
}


async function evaluatePythonCode(req, res) {
  const {
    questionText,
    studentCode,
    codeVersion,
    guidance = "",
    isCodeOnly = false,
    feedbackPrompt = ""
  } = req.body;

  if (!questionText || !studentCode) {
    return res.status(400).json({ error: 'Missing question text or student code' });
  }

  // --- Split guidance into per-question + activity ---
  const combinedGuide = stripHtml(guidance || '');
  const parts = combinedGuide.split(/\n-{3,}\n/);  // '---' splitter
  const questionGuide = parts[0] || "";
  const activityGuide = parts[1] || "";

  // 🔒 HARD SKIP: if this question’s feedback prompt is "none" in EITHER place,
  // do not call OpenAI at all for code.
  const fp = String(feedbackPrompt || '').trim();
  if (
    isNone(fp) || noFollowups(fp) ||
    isNone(questionGuide) || noFollowups(questionGuide)
  ) {
    return res
      .status(200)
      .json({ feedback: null, followup: null, verdict: 'minor' });
  }

  const policy = getEffectivePolicy(activityGuide, questionGuide);

  const rules = [
    policy.requirementsOnly && '- Judge ONLY whether it meets the stated task; no extras.',
    policy.ignoreSpacing && '- Ignore whitespace/formatting; never mention spacing.',
    policy.forbidFStrings && "- Do NOT suggest or use f-strings (environment may not support them).",
    policy.noExtras && '- Do NOT ask for additional features beyond the prompt.',
    policy.failOpen && '- If minor issues but functionally OK, treat as correct.',
    '- Assume standard Python 3 with full f-string support. ' +
      'If a print statement already has matching parentheses, NEVER say it is missing a parenthesis. ' +
      'Do NOT recommend switching to f-strings as an “improvement” when they are not used.'
  ].filter(Boolean).join('\n');


  const prompt = `
You are a Python tutor evaluating a student's code.

Per-question guidance (authoritative; do not quote):
${questionGuide || "(none)"}

Activity guidance (fallback; do not quote):
${activityGuide || "(none)"}

Task:
${questionText}

Student's code (v${codeVersion}):
\`\`\`python
${studentCode}
\`\`\`

Return STRICT JSON:
{"verdict":"correct"|"minor"|"wrong"|"off_prompt"|"error","feedback":string|null,"followup":string|null}

Definitions:
- "correct": Meets the task; acceptable output/logic.
- "minor": Only trivial output/format differences that do NOT affect the task.
- "wrong": There exists a concrete input for which the code clearly fails the stated task.
- "off_prompt": Solves something else / ignores instructions.
- "error": Syntax/runtime error or cannot reasonably run.

IMPORTANT:
- Only call something "wrong" or "error" if you can describe at least one specific input (or scenario) where it fails.
- If you cannot find a clear failing input and the code matches the task in spirit, use "correct" or "minor".

Rules:
- If "correct" or "minor": feedback=null, followup=null. (No nits.)
- If "wrong": feedback = ONE concise fix hint (single sentence). followup=null.
- If "off_prompt" or "error": feedback = ONE concise fix hint; followup = ONE short (5–15 words) nudge question.
- No style/naming/formatting/spacing advice. No extra features beyond the prompt.
- Do NOT suggest f-strings if guidance says they’re unavailable.
${rules ? '\n' + rules : ''}
`.trim();

  try {
    const chat = await openai.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 220,
    });

    const raw = (chat.choices?.[0]?.message?.content ?? '').trim();
    const match = raw.match(/\{[\s\S]*\}/);
    let obj = match ? JSON.parse(match[0]) : JSON.parse(raw);

    let verdict = String(obj.verdict || '').toLowerCase();
    let feedback = obj.feedback && String(obj.feedback).trim() || null;
    let followup = obj.followup && String(obj.followup).trim() || null;

    // Drop soft/nitpicky stuff
    if (isSoft(feedback)) feedback = null;
    if (isSoft(followup)) followup = null;

    // Enforce "no followups" gate
    if (policy.followupGate === 'none') followup = null;

    const forbidValueNags =
      /\bjudge\b.*\blogic\b.*\bnot\b.*\b(true|false|result)\b/i.test(`${questionGuide} ${activityGuide}`) ||
      /\bdo not ask\b.*\bchange\b.*\bvalues?\b/i.test(`${questionGuide} ${activityGuide}`);

    if (forbidValueNags) {
      if (mentionsValueTweak(followup)) followup = null;
      if (mentionsValueTweak(feedback)) feedback = null;
    }

    // 🔒 Emergency clamp: only give feedback for clear errors or off-prompt.
    // Treat "wrong" as "minor" so we don't get bogus "improvements" suggestions.
    if (verdict === 'wrong') {
      verdict = 'minor';
      feedback = null;
      followup = null;
    } else if (verdict === 'correct' || verdict === 'minor') {
      feedback = null;
      followup = null;
    } else if (verdict === 'off_prompt' || verdict === 'error') {
      // Keep feedback for truly broken / off-prompt code,
      // but still obey "no followups" policy.
      if (policy.followupGate === 'none') followup = null;
    } else {
      verdict = 'minor';
      feedback = null;
      followup = null;
    }


    if (policy.followupGate === 'gibberish-only') {
      const gib = codeLooksGibberish(studentCode);
      if (!gib && verdict !== 'error' && verdict !== 'off_prompt') followup = null;
    }

    console.log('[POLICY]', {
      followupGate: policy.followupGate,
      verdict,
      forbidValueNags,
      hasFU: !!followup
    });

    return res.json({ feedback, followup, verdict });
  } catch (err) {
    console.error('Error evaluating Python code:', err);
    return res.status(200).json({ feedback: null, followup: null, verdict: 'minor' });
  }
}




function getEffectivePolicy(activityGuide, questionGuide) {
  const a = derivePolicyFromGuidance(activityGuide);
  const q = derivePolicyFromGuidance(questionGuide);

  const qBareNone = /^\s*(none|no\s*follow-?ups?|no\s*follow\s*ups?)\s*$/i
    .test(stripHtml(questionGuide || ''));

  const qFU = (String(questionGuide || '').match(/follow[-\s]*ups?\s*:\s*(none|gibberish-only|default)/i) || [])[1];
  const aFU = (String(activityGuide || '').match(/follow[-\s]*ups?\s*:\s*(none|gibberish-only|default)/i) || [])[1];

  const followupGate = qBareNone
    ? 'none'
    : (qFU || aFU || q.followupGate || a.followupGate || 'default').toLowerCase();

  // For other flags, let per-question override when it explicitly mentions them; otherwise inherit.
  const pick = (flag, regex) => {
    const qMentions = new RegExp(regex, 'i').test(String(questionGuide || ''));
    return qMentions ? q[flag] : a[flag];
  };

  return {
    followupGate,
    requirementsOnly: pick('requirementsOnly', 'requirements-only'),
    ignoreSpacing: pick('ignoreSpacing', 'ignore spacing'),
    forbidFStrings: pick('forbidFStrings', 'f-strings'),
    failOpen: pick('failOpen', "fail[- ]open|doesn'?t have to be perfect"),
    noExtras: pick('noExtras', 'do not require extra features|do not require extras'),
  };
}


// server/ai/controller.js

// Keep the helpers added earlier: stripHtml, derivePolicyFromGuidance, isFatal, isSoft

async function evaluateCode({
  questionText,
  studentCode,
  codeVersion,
  guidance = "",      // \aicodeguidance + maybe question guidance
  isCodeOnly = false, // pure code question?
  feedbackPrompt = "",
  lang,
}) {
  if (!questionText || !studentCode) {
    return { feedback: null, followup: null };
  }

  // Hard skip if per-question feedback prompt is explicitly "none"
  if (String(feedbackPrompt).trim().toLowerCase() === "none") {
    return { feedback: null, followup: null };
  }

  // --- Split guidance into per-question + activity ---
  const combined = stripHtml(guidance || "");
  const parts = combined.split(/\n-{3,}\n/); // '---' splitter
  const fallbackQ = parts[0] || "";
  const fallbackA = parts[1] || combined;

  // Per-question guidance: feedbackPrompt wins if present and not "none"
  const questionGuideRaw =
    feedbackPrompt && !isNone(feedbackPrompt) ? feedbackPrompt : fallbackQ;

  const qGuide = stripHtml(questionGuideRaw || "");
  const aGuide = stripHtml(fallbackA || "");

  // 🔒 HARD SKIP for \feedbackprompt{none} / "no follow-ups"
  const fp = String(feedbackPrompt || "").trim();
  if (
    isNone(fp) ||
    noFollowups(fp) ||
    isNone(qGuide) ||
    noFollowups(qGuide)
  ) {
    return { feedback: null, followup: null };
  }

  const policy = getEffectivePolicy(aGuide, qGuide);

  // ✅ infer language BEFORE building rules
  const inferred = detectLangFromCode(studentCode);
  const effLang = (lang || inferred || "").toLowerCase();

  let langLabel = "the correct language for this code";
  if (effLang === "cpp" || effLang === "c++") langLabel = "C++";
  else if (effLang === "python") langLabel = "Python";

  const rules = [
    policy.requirementsOnly
      ? "- Judge ONLY whether it meets the stated task; no extras."
      : "",
    policy.ignoreSpacing
      ? "- Ignore whitespace/formatting; never mention spacing."
      : "",
    policy.forbidFStrings
      ? "- Do NOT suggest or use f-strings (environment may not support them)."
      : "",
    policy.noExtras
      ? "- Do NOT ask for additional features beyond the prompt."
      : "",
    policy.failOpen
      ? "- If minor issues but functionally OK, treat as correct (feedback=null, followup=null)."
      : "",
    effLang === "python"
      ? "- Assume standard Python 3 with f-strings; do NOT claim missing parentheses for syntactically valid print statements."
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = `
You are a ${langLabel} tutor evaluating a student's code.

Per-question guidance (AUTHORITATIVE for this item):
${qGuide || "(none)"}

Activity guidance (FALLBACK if the question is silent):
${aGuide || "(none)"}

Task:
${questionText}

Student's code (v${codeVersion}):
\`\`\`${effLang === "cpp" || effLang === "c++" ? "cpp" : effLang === "python" ? "python" : ""}
${studentCode}
\`\`\`

Return STRICT JSON with exactly these keys:
{"feedback": string|null, "followup": string|null}

Rules:
- Base ALL syntax and feedback on ${langLabel}.
- If the code is fully correct and appropriate: feedback=null, followup=null.
- Otherwise:
  - "feedback" = ONE concise, actionable suggestion (single sentence).
  - "followup" = ${isCodeOnly ? "ONE short tutor-style question (5–20 words) nudging toward the fix." : "null"}
- No style/naming/formatting nits. No extra features beyond the prompt.
- Do NOT give Python-specific advice for non-Python code.
${rules ? "\n" + rules : ""}
`.trim();

  try {
    const chat = await openai.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 180,
    });

    const raw = (chat.choices?.[0]?.message?.content ?? "").trim();
    const match = raw.match(/\{[\s\S]*\}/);
    let obj = match ? JSON.parse(match[0]) : JSON.parse(raw);

    let feedback =
      obj.feedback == null || String(obj.feedback).trim() === ""
        ? null
        : String(obj.feedback).trim();
    let followup =
      obj.followup == null || String(obj.followup).trim() === ""
        ? null
        : String(obj.followup).trim();

    const fatal = isFatal(feedback) || isFatal(followup);

    if (policy.followupGate === "none") {
      followup = null;
    }

    // Strip soft / nitpicky stuff unless it's clearly fatal
    if (isSoft(feedback) && !fatal) feedback = null;
    if (isSoft(followup) && !fatal) followup = null;

    return { feedback, followup };
  } catch (err) {
    console.error("Error in evaluateCode:", err);
    return { feedback: null, followup: null };
  }
}

// --- Test-question grader: returns numeric scores + short feedback ---
// Now returns three bands: code, run/output, response
async function gradeTestQuestion({
  questionText,
  scores = {}, // rubric buckets from the sheet: { code, output, response }
  responseText = "", // student's written answer
  codeCells = [], // [{ code: "...", lang?: "cpp"|"python", label?: "..." }, ...]
  outputText = "", // captured program output, if any
  rubric = {}, // same as scores in most calls
}) {
  const bucketPoints = (bucket) => {
    if (bucket == null) return 0;
    if (typeof bucket === "number") return bucket;
    if (typeof bucket === "object" && typeof bucket.points === "number") {
      return bucket.points;
    }
    return 0;
  };

  // ---- Point caps per band ----
  const codeBucket = scores.code || rubric.code || {};
  const runBucket = scores.output || rubric.output || {};
  const respBucket = scores.response || rubric.response || {};

  const maxCodePts = bucketPoints(codeBucket);
  const maxRunPts = bucketPoints(runBucket);
  const maxRespPts = bucketPoints(respBucket);

  const maxTotal = maxCodePts + maxRunPts + maxRespPts;

  if (maxTotal <= 0) {
    console.log("🧮 gradeTestQuestion: no points configured; skipping AI grade.");
    return {
      codeScore: 0,
      codeFeedback: "",
      runScore: 0,
      runFeedback: "",
      responseScore: 0,
      responseFeedback: "",
    };
  }

  // ---- Rubric text per band ----
  const codeRubricText =
    stripHtml(
      codeBucket.instructionsRaw || codeBucket.instructionsHtml || ""
    ) || "(none)";

  const runRubricText =
    stripHtml(runBucket.instructionsRaw || runBucket.instructionsHtml || "") ||
    "(none)";

  const responseRubricText =
    stripHtml(respBucket.instructionsRaw || respBucket.instructionsHtml || "") ||
    "(none)";

  // ---- Build code bundle for the prompt ----
  const codeBundle = codeCells
    .map((cell, idx) => {
      const lang = (cell.lang || "").toLowerCase();
      const label = cell.label ? ` (${cell.label})` : "";
      const fence =
        lang === "cpp" || lang === "c++"
          ? "cpp"
          : lang === "python"
          ? "python"
          : "";
      return [
        `Code cell ${idx + 1}${label}:`,
        "```" + fence,
        cell.code || "",
        "```",
      ].join("\n");
    })
    .join("\n\n");

  const sys = [
    "You are grading a short quiz/exam question for an intro programming course.",
    "You will assign numeric points separately for:",
    "- CODE (implementation quality / correctness)",
    "- RUN (program output, tests, harness behavior)",
    "- RESPONSE (written explanation or short answer).",
    "Use the rubric text exactly; partial credit is allowed.",
    "If a band has full credit, feedback for that band should be null.",
    "Return ONLY JSON, no commentary.",
  ].join("\n");

  const userLines = [];

  userLines.push("Question:");
  userLines.push(stripHtml(questionText || "(missing)"));
  userLines.push("");

  userLines.push(`Max code points: ${maxCodePts}`);
  userLines.push(`Max run/output points: ${maxRunPts}`);
  userLines.push(`Max response points: ${maxRespPts}`);
  userLines.push("");

  userLines.push("Rubric for CODE band:");
  userLines.push(codeRubricText);
  userLines.push("");

  userLines.push("Rubric for RUN/OUTPUT band:");
  userLines.push(runRubricText);
  userLines.push("");

  userLines.push("Rubric for RESPONSE band:");
  userLines.push(responseRubricText);
  userLines.push("");

  userLines.push("Student written RESPONSE (if any):");
  userLines.push(stripHtml(responseText || "(none)"));
  userLines.push("");

  if (codeBundle) {
    userLines.push("Student CODE submission(s):");
    userLines.push(codeBundle);
    userLines.push("");
  } else {
    userLines.push("Student CODE submission(s): (none)");
    userLines.push("");
  }

  if (outputText) {
    userLines.push("PROGRAM OUTPUT / TEST OUTPUT:");
    userLines.push(stripHtml(outputText));
    userLines.push("");
  } else {
    userLines.push("PROGRAM OUTPUT / TEST OUTPUT: (none provided).");
    userLines.push("");
  }

  userLines.push(
    `Return strict JSON only in this form:\n` +
      `{"codeScore": number, "codeFeedback": string|null, ` +
      `"runScore": number, "runFeedback": string|null, ` +
      `"responseScore": number, "responseFeedback": string|null}\n` +
      `- codeScore must be between 0 and ${maxCodePts}.\n` +
      `- runScore must be between 0 and ${maxRunPts}.\n` +
      `- responseScore must be between 0 and ${maxRespPts}.\n` +
      `- For any band with full credit, feedback for that band MUST be null.\n` +
      `- For bands with less than full credit, feedback should be ONE short sentence explaining why.`
  );

  const user = userLines.join("\n");

  try {
    const chat = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { name: "grader", role: "system", content: sys },
        { role: "user", content: user },
      ],
      temperature: 0.1,
      max_tokens: 260,
    });

    const raw = (chat.choices?.[0]?.message?.content ?? "").trim();
    const match = raw.match(/\{[\s\S]*\}/);
    const jsonStr = match ? match[0] : raw;

    let obj;
    try {
      obj = JSON.parse(jsonStr);
    } catch (e) {
      console.error("❌ gradeTestQuestion JSON parse error:", e, "raw:", raw);
      return {
        codeScore: 0,
        codeFeedback: "",
        runScore: 0,
        runFeedback: "",
        responseScore: 0,
        responseFeedback: "",
      };
    }

    let codeScore = Number(obj.codeScore ?? 0);
    let runScore = Number(obj.runScore ?? 0);
    let responseScore = Number(obj.responseScore ?? 0);

    if (!Number.isFinite(codeScore)) codeScore = 0;
    if (!Number.isFinite(runScore)) runScore = 0;
    if (!Number.isFinite(responseScore)) responseScore = 0;

    // Clamp into bands
    codeScore = Math.max(0, Math.min(maxCodePts, codeScore));
    runScore = Math.max(0, Math.min(maxRunPts, runScore));
    responseScore = Math.max(0, Math.min(maxRespPts, responseScore));

    const codeFeedback =
      (obj.codeFeedback && String(obj.codeFeedback).trim()) || "";
    const runFeedback =
      (obj.runFeedback && String(obj.runFeedback).trim()) || "";
    const responseFeedback =
      (obj.responseFeedback && String(obj.responseFeedback).trim()) || "";

    console.log("🧮 gradeTestQuestion result:", {
      maxCodePts,
      maxRunPts,
      maxRespPts,
      codeScore,
      runScore,
      responseScore,
    });

    return {
      codeScore,
      codeFeedback,
      runScore,
      runFeedback,
      responseScore,
      responseFeedback,
    };
  } catch (err) {
    console.error("❌ gradeTestQuestion OpenAI error:", err);
    return {
      codeScore: 0,
      codeFeedback: "",
      runScore: 0,
      runFeedback: "",
      responseScore: 0,
      responseFeedback: "",
    };
  }
}

// C++-specific HTTP handler that wraps evaluateCode with lang="cpp"
async function evaluateCppCode(req, res) {
  const {
    questionText,
    studentCode,
    codeVersion,
    guidance = "",
    isCodeOnly = false,
    feedbackPrompt = "",
  } = req.body || {};

  if (!questionText || !studentCode) {
    return res.status(400).json({ error: "Missing question text or student code" });
  }

  try {
    const { feedback, followup } = await evaluateCode({
      questionText,
      studentCode,
      codeVersion,
      guidance,
      isCodeOnly,
      feedbackPrompt,
      lang: "cpp", // 🔒 FORCE C++
    });

    // You can add a verdict if your client expects one; "minor" is a safe default
    return res.status(200).json({ feedback, followup, verdict: "minor" });
  } catch (err) {
    console.error("Error evaluating C++ code:", err);
    return res
      .status(200)
      .json({ feedback: null, followup: null, verdict: "minor" });
  }
}

module.exports = {
  evaluateStudentResponse,
  evaluatePythonCode,
  evaluateCode,
  gradeTestQuestion,
  evaluateCppCode,
};
