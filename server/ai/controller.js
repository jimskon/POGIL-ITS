// server/ai/controller.js
const OpenAI = require("openai");
require("dotenv").config();

const { gradeTestQuestionHttp, gradeTestQuestion } = require("./grading");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// ---------- Shared helpers ----------
function stripHtml(s = "") {
  return String(s)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[A-Za-z!][^>]*>/g, "");
}

// ---------- Positive feedback toggles ----------
// Activity-level default: Positive feedback ON.
// Per-question override: put "No-Positive-feedback" anywhere in \followupprompt{...}
// Case-insensitive everywhere.

const POSITIVE_ON_TOKEN = "positive-feedback";
const POSITIVE_OFF_TOKEN = "no-positive-feedback";

function parsePositiveFeedbackFromText(text = "") {
  const raw = stripHtml(text || "");
  const lower = raw.toLowerCase();

  const hasOff = lower.includes(POSITIVE_OFF_TOKEN);
  const hasOn = lower.includes(POSITIVE_ON_TOKEN);

  // Remove tokens wherever they appear (case-insensitive)
  const cleaned = raw
    .replace(new RegExp(POSITIVE_OFF_TOKEN, "ig"), "")
    .replace(new RegExp(POSITIVE_ON_TOKEN, "ig"), "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { hasOff, hasOn, cleaned };
}

function isPositiveFeedbackEnabled(activityGuidance = "", followupPrompt = "") {
  const a = parsePositiveFeedbackFromText(activityGuidance);
  const q = parsePositiveFeedbackFromText(followupPrompt);

  // Question-level overrides always win
  if (q.hasOff) return false;
  if (q.hasOn) return true;

  // Activity-level applies if question didn't override
  if (a.hasOff) return false;
  if (a.hasOn) return true;

  // Default = ON
  return true;
}


const isNone = (s) => /^\s*none\s*$/i.test(String(s || "").trim());

const FATAL_PATTERNS = [
  /Traceback/i,
  /SyntaxError/i,
  /NameError/i,
  /TypeError/i,
  /ZeroDivisionError/i,
  /\bruntimeerror\b/i,
  /\binfinite loop\b/i,
  /\bwon'?t run\b/i,
  /\bdoes not run\b/i,
];

function isFatal(text) {
  const t = String(text || "").trim();
  return !!t && FATAL_PATTERNS.some((r) => r.test(t));
}

// IMPORTANT: keep “learning encouragement” phrases OUT of this filter.
// Only strip actual nitpicks: style, naming, spacing, refactor, optimize, extras.
const SOFT_PATTERNS = [
  /\bstyle\b/i,
  /\bnaming\b/i,
  /\bformat(ting)?\b/i,
  /\bspacing\b/i,
  /uppercase.*lowercase/i,
  /\brefactor\b/i,
  /\boptimi[sz]e\b/i,
  /\bextra feature\b/i,
];

function isSoftNitpick(text) {
  const t = String(text || "").trim();
  return !t || SOFT_PATTERNS.some((r) => r.test(t));
}

const GIBBERISH_PATTERNS = [
  /^\s*$/,
  /^(idk|i don'?t know|dunno|n\/a)\s*$/i,
  /^[^a-zA-Z0-9]{3,}$/,
  /^[a-z]{1,2}\s*$/i,
];

function looksGibberish(ans) {
  const a = String(ans || "").trim();
  if (GIBBERISH_PATTERNS.some((r) => r.test(a))) return true;
  if (/^(true|false)$/i.test(a)) return false;
  if (/^[\d\s.+\-*/%()=<>!]+$/.test(a)) return false;
  return a.length < 2;
}

function detectLangFromCode(src = "") {
  const s = String(src).trim();
  if (!s) return null;
  if (
    /\b#include\s*<[^>]+>/.test(s) ||
    /\bint\s+main\s*\(/.test(s) ||
    /std::(cout|cin|string)/.test(s)
  )
    return "cpp";
  if (/\bdef\s+\w+\s*\(/.test(s) || /\bprint\s*\(/.test(s) || /^\s*#/.test(s))
    return "python";
  return null;
}

// ---------- Guidance → policy ----------
function derivePolicyFromGuidance(guidanceText = "") {
  const g = stripHtml(guidanceText).toLowerCase().trim();

  if (/^(none|no\s*follow-?ups?|no\s*follow\s*ups?)$/.test(g)) {
    return {
      followupGate: "none",
      requirementsOnly: false,
      ignoreSpacing: false,
      forbidFStrings: false,
      failOpen: false,
      noExtras: false,
    };
  }

  const explicitFU =
    (g.match(/follow[-\s]*ups?\s*:\s*(none|gibberish-only|default)/i) || [])[1] ||
    null;

  const noFollowupFlag = /do not ask a follow up/.test(g);
  const requirementsOnly = /requirements-only/.test(g);
  const ignoreSpacing = /ignore spacing/.test(g);
  const forbidFStrings = /f-strings.*(unavailable|do not|don't)/.test(g);
  const failOpen =
    /fail[- ]open/.test(g) || /doesn'?t have to be perfect/.test(g);
  const noExtras = /do not require extra features|do not require extras/.test(g);

  const followupGate = explicitFU
    ? explicitFU.toLowerCase()
    : noFollowupFlag
      ? "none"
      : "default";

  return {
    followupGate,
    requirementsOnly,
    ignoreSpacing,
    forbidFStrings,
    failOpen,
    noExtras,
  };
}

function getEffectivePolicy(activityGuide, questionGuide) {
  const a = derivePolicyFromGuidance(activityGuide);
  const q = derivePolicyFromGuidance(questionGuide);

  // If question guide is literally "none", interpret as "no followups"
  const qBareNone = /^\s*(none|no\s*follow-?ups?|no\s*follow\s*ups?)\s*$/i.test(
    stripHtml(questionGuide || "")
  );

  const qFU =
    (String(questionGuide || "").match(
      /follow[-\s]*ups?\s*:\s*(none|gibberish-only|default)/i
    ) || [])[1] || null;

  const aFU =
    (String(activityGuide || "").match(
      /follow[-\s]*ups?\s*:\s*(none|gibberish-only|default)/i
    ) || [])[1] || null;

  const followupGate = qBareNone
    ? "none"
    : (qFU || aFU || q.followupGate || a.followupGate || "default").toLowerCase();

  const pick = (flag, regex) => {
    const qMentions = new RegExp(regex, "i").test(String(questionGuide || ""));
    return qMentions ? q[flag] : a[flag];
  };

  return {
    followupGate,
    requirementsOnly: pick("requirementsOnly", "requirements-only"),
    ignoreSpacing: pick("ignoreSpacing", "ignore spacing"),
    forbidFStrings: pick("forbidFStrings", "f-strings"),
    failOpen: pick("failOpen", "fail[- ]open|doesn'?t have to be perfect"),
    noExtras: pick(
      "noExtras",
      "do not require extra features|do not require extras"
    ),
  };
}

// ---------- STUDENT RESPONSE (TEXT, LEARNING MODE) ----------
async function evaluateStudentResponse(req, res) {
  const {
    questionText,
    studentAnswer,
    sampleResponse = "", // \sampleresponses
    feedbackPrompt = "", // \feedbackprompt  (meta policy; do not quote)
    followupPrompt = "", // \followupprompt  (optional planned engagement)
    forceFollowup = false,
    guidance = "",       // \aicodeguidance  (activity-level)
    codeContext = "",
  } = req.body || {};

  // Hard “no feedback at all” switch (rare, but keep it)
  if (isNone(feedbackPrompt) || !questionText || studentAnswer == null) {
    return res.status(200).json({
      accepted: true,
      comment: null,
      followupQuestion: null,
    });
  }


  const activityGuide = stripHtml(guidance || "");
  const questionGuide = stripHtml(feedbackPrompt || "");
  const policy = getEffectivePolicy(activityGuide, questionGuide);

  const answerRaw = String(studentAnswer || "").trim();

  // Positive-feedback directives live inside followupprompt; strip them and compute flags.
  const positiveEnabled = isPositiveFeedbackEnabled(guidance, followupPrompt);
  const fuParsed = parsePositiveFeedbackFromText(followupPrompt);
  const followupRaw = fuParsed.cleaned;
  const followupIsNone = /^(none|no\s*follow-?ups?)$/i.test(followupRaw);


  // Quick accept path for requirements-only + non-gibberish
  // (Still allows planned followups via followupprompt)
  if (policy.requirementsOnly && !forceFollowup) {
    if (!answerRaw || looksGibberish(answerRaw)) {
      // fall through to AI
    } else {
      // cheap relevance check
      const q = stripHtml(questionText || "").toLowerCase();
      const s = stripHtml(answerRaw).toLowerCase();
      const sample = stripHtml(sampleResponse || "").toLowerCase();

      const extractWords = (text) =>
        text.split(/\W+/).filter((w) => w.length > 4);

      const qWords = extractWords(q);
      const sampleWords = extractWords(sample);
      const containsAny = (words, haystack) => words.some((w) => haystack.includes(w));

      const relevant =
        (qWords.length && containsAny(qWords, s)) ||
        (sampleWords.length && containsAny(sampleWords, s));

      if (relevant) {
        // On-track: optionally use author follow-up (unless policy forbids)
        const allowFollowup = policy.followupGate !== "none" && !followupIsNone;
        return res.status(200).json({
          accepted: true,
          comment: null,
          followupQuestion: allowFollowup ? followupRaw : null,
        });

      }
    }
  }

  // If answer is obviously empty/gibberish, we can force a follow-up regardless of author followupPrompt.
  const obviouslyBad = !answerRaw || looksGibberish(answerRaw);

  // Build prompt
  const sys = [
    "You are a concise, supportive learning facilitator for an ungraded collaborative activity.",
    "Your job is to decide whether the response is sufficient to proceed.",
    "Return status='complete' if the response is coherent and on-topic enough.",
    "Return status='revise' if the response is incoherent, off-prompt, clearly wrong overall, or too thin/vague.",
    "If status='complete', comment should be null unless positive feedback is allowed.",
    "If status='revise', comment MUST be a short helpful hint/encouragement (1–2 sentences).",
    "followupQuestion should be null unless a single short follow-up question is truly needed (usually only for revise).",
    "Do NOT mention grading, points, rubrics, or scoring.",
    "Return ONLY JSON.",
  ].join("\n");

  const schema = `Return JSON only:
{"status":"complete"|"revise",
 "comment": null|string,
 "followupQuestion": null|string}`;


  const user = [
    `Question:\n${stripHtml(questionText)}`,
    codeContext ? `Shown code/context:\n${stripHtml(codeContext)}` : "",
    sampleResponse
      ? `Sample / acceptance envelope (do not quote):\n${stripHtml(sampleResponse)}`
      : "",
    questionGuide ? `Instructor feedbackprompt (meta; do not quote):\n${questionGuide}` : "",
    followupRaw && !followupIsNone
      ? `Instructor followupprompt (optional; prefer this wording if you choose to ask a follow-up):\n${followupRaw}`
      : "",
    `Student submission:\n${stripHtml(studentAnswer)}`,
    "",
    schema,
    forceFollowup || obviouslyBad
      ? "If uncertain, prefer status='revise'."
      : "If reasonable, prefer status='complete'.",
    "Keep comment to 1–2 short sentences max; followupQuestion should be a single short question (or null).",


  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const chat = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      temperature: 0.2,
      max_tokens: 220,
    });

    const raw = (chat.choices?.[0]?.message?.content ?? "").trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    let obj;
    try {
      obj = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(raw);
    } catch {
      return res.status(200).json({
        accepted: true,
        comment: null,
        followupQuestion: null,
      });
    }

    const status = String(obj.status || "").toLowerCase();
    let comment = obj.comment ? String(obj.comment).trim() : null;
    let followupQuestion = obj.followupQuestion ? String(obj.followupQuestion).trim() : null;

    // Strip true nitpicks only
    if (isSoftNitpick(comment) && !isFatal(comment)) {
      comment = (status === "revise")
        ? null   // will be replaced by fallback below
        : null;
    }


    // Enforce followup gate
    if (policy.followupGate === "none") followupQuestion = null;

    if (status === "complete") {
      // No-positive-feedback disables any praise/comment on completion
      if (!positiveEnabled) comment = null;

      // On complete: use author followupprompt only if followups are enabled and prompt isn't "none"
      const allowAuthorFU = policy.followupGate !== "none" && !followupIsNone;

      return res.status(200).json({
        accepted: true,
        comment: comment || null,
        followupQuestion: allowAuthorFU ? followupRaw : null,
      });
    }

    // Default to revise
    if (!comment) comment = "Add one more concrete detail that directly answers the prompt.";

    const allowAuthorFU = policy.followupGate !== "none" && !followupIsNone;

    return res.status(200).json({
      accepted: false,
      comment,
      followupQuestion: allowAuthorFU ? followupRaw : followupQuestion,
    });


  } catch (err) {
    console.error("❌ OpenAI evaluateStudentResponse failed:", err);
    return res.status(200).json({
      accepted: true,
      comment: null,
      followupQuestion: null,
    });

  }
}

// ---------- PYTHON CODE (LEARNING MODE) ----------
async function evaluatePythonCode(req, res) {
  const {
    questionText,
    studentCode,
    codeVersion,
    guidance = "",
    isCodeOnly = false,
    feedbackPrompt = "",
    sampleResponse = "",
    followupPrompt = "",
  } = req.body || {};

  if (!questionText || !studentCode) {
    return res.status(400).json({ error: "Missing question text or student code" });
  }

  const result = await evaluateCode({
    questionText,
    studentCode,
    codeVersion,
    guidance,
    isCodeOnly,
    feedbackPrompt,
    sampleResponse,
    followupPrompt,
    lang: "python",
  });

  return res.status(200).json(result);
}


function safeJsonObject(raw = "") {
  const s = String(raw || "").trim();
  const match = s.match(/\{[\s\S]*\}/);
  const candidate = match ? match[0] : s;
  try {
    const obj = JSON.parse(candidate);
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}

async function evaluateCode({
  questionText,
  studentCode,
  codeVersion,
  guidance = "",
  isCodeOnly = false,
  feedbackPrompt = "",
  sampleResponse = "",
  followupPrompt = "",
  lang,
}) {
  // Default: never block progress
  const base = { accepted: true, feedback: null, followup: null, needsRevision: false };

  if (!questionText || !studentCode) return base;

  const suppressFeedback = isNone(feedbackPrompt);

  const combined = stripHtml(guidance || "");
  const parts = combined.split(/\n-{3,}\n/);
  const qGuide = stripHtml(feedbackPrompt || "");
  const aGuide = parts[1] || parts[0] || combined;
  const policy = getEffectivePolicy(aGuide, qGuide);

  const inferred = detectLangFromCode(studentCode);
  const effLang = String(lang || inferred || "").toLowerCase();

  let langLabel = "the correct language for this code";
  if (effLang === "cpp" || effLang === "c++") langLabel = "C++";
  else if (effLang === "python") langLabel = "Python";

  const positiveEnabled = isPositiveFeedbackEnabled(guidance, followupPrompt);
  const fuParsed = parsePositiveFeedbackFromText(followupPrompt);
  const followupRaw = fuParsed.cleaned;
  const followupIsNone = /^(none|no\s*follow-?ups?)$/i.test(followupRaw);

  const rules = [
    policy.requirementsOnly && "- Judge ONLY whether it meets the stated task; no extras.",
    policy.ignoreSpacing && "- Ignore whitespace/formatting; never mention spacing.",
    policy.forbidFStrings && "- Do NOT suggest or use f-strings (environment may not support them).",
    policy.noExtras && "- Do NOT ask for additional features beyond the prompt.",
    policy.failOpen && "- If minor issues but functionally OK, treat as acceptable.",
    "feedbackprompt is meta guidance; do NOT quote it.",
    "Before suggesting to add a line, verify it is not already present (or equivalent) in the code.",
  ].filter(Boolean).join("\n");

  const fence =
    effLang === "cpp" || effLang === "c++" ? "cpp" :
    effLang === "python" ? "python" : "";

  const prompt = `
You are a ${langLabel} tutor facilitating an UNGRADED collaborative learning activity.

Task:
${stripHtml(questionText)}

Acceptance envelope (do not quote):
${stripHtml(sampleResponse || "(none)")}

Instructor feedbackprompt (meta; do not quote):
${qGuide || "(none)"}

Student's code (v${codeVersion}):
\`\`\`${fence}
${studentCode}
\`\`\`

Return STRICT JSON with exactly these keys:
{"accepted":true|false,"feedback":string|null,"followup":string|null}

Rules:
- accepted=true if it meets the task; feedback may be null OR brief encouragement (no nitpicks).
- accepted=false if incomplete/off-prompt; feedback = ONE actionable hint; followup optional.
- followup should be null unless ${isCodeOnly ? "a short question is useful" : "needed"}.
- No style/naming/formatting nits. No extra features beyond the prompt.
${rules ? "\n" + rules : ""}
`.trim();

  let chat;
  try {
    chat = await openai.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 220,
    });
  } catch (err) {
    console.error("❌ OpenAI evaluateCode failed:", err);
    return base;
  }

  const raw = (chat.choices?.[0]?.message?.content ?? "").trim();
  const obj = safeJsonObject(raw);
  if (!obj) return base;

  // Model's gating decision (we *don’t* use it to block progress)
  const modelAccepted = !!obj.accepted;

  let feedback = obj.feedback ? String(obj.feedback).trim() : null;
  let followup = obj.followup ? String(obj.followup).trim() : null;

  if (isSoftNitpick(feedback) && !isFatal(feedback)) feedback = null;
  if (policy.followupGate === "none") followup = null;

  if (suppressFeedback) feedback = null;
  if (modelAccepted && !positiveEnabled) feedback = null;

  const allowAuthorFU = policy.followupGate !== "none" && !followupIsNone;
  if (allowAuthorFU) followup = followupRaw || followup || null;

  // If the model thinks it’s not accepted, we still continue but we preserve guidance
  const needsRevision = !modelAccepted;

  // Ensure we provide something helpful if needsRevision is true
  if (needsRevision && !feedback) {
    feedback = "Make one small change that directly moves the code toward the stated task.";
  }

  return {
    accepted: true,          // ✅ ALWAYS continue
    feedback,
    followup,
    needsRevision,           // ✅ non-blocking signal
  };
}


async function evaluateCppCode(req, res) {
  const {
    questionText,
    studentCode,
    codeVersion,
    guidance = "",
    isCodeOnly = false,
    feedbackPrompt = "",
    sampleResponse = "",
    followupPrompt = "",
  } = req.body || {};

  if (!questionText || !studentCode) {
    return res.status(400).json({ error: "Missing question text or student code" });
  }

  const result = await evaluateCode({
    questionText,
    studentCode,
    codeVersion,
    guidance,
    isCodeOnly,
    feedbackPrompt,
    sampleResponse,
    followupPrompt,
    lang: "cpp",
  });

  return res.status(200).json(result);
}


// NOTE: plug your existing gradeTestQuestion + gradeTestQuestionHttp here unchanged
// (omitted in this snippet to keep it readable)

module.exports = {
  evaluateStudentResponse,
  evaluatePythonCode,
  evaluateCode,
  evaluateCppCode,
  gradeTestQuestion,
  gradeTestQuestionHttp,
};
