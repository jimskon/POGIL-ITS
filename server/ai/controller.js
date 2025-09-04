// server/ai/controller.js
const OpenAI = require('openai');
require('dotenv').config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'; // keep model configurable

// server/ai/controller.js
async function evaluateStudentResponse(req, res) {
  const {
    questionText,
    studentAnswer,
    sampleResponse,
    feedbackPrompt,
    followupPrompt,
    forceFollowup = false,
    context = {}
  } = req.body;

  if (!questionText || !studentAnswer) {
    return res.status(400).json({
      error: 'Missing required fields',
      missing: {
        questionText: !questionText,
        studentAnswer: !studentAnswer,
      }
    });
  }

  try {
    const ctx = `${context.activityContext || context.activitycontext || 'Unnamed Activity'} (${context.studentLevel || 'intro level'})`;
    const guide = (feedbackPrompt && feedbackPrompt.toLowerCase() !== 'none') ? feedbackPrompt : '';
    const authoredGuide = (followupPrompt || '').trim();

    // ---------- helpers ----------
    const looksLikeRubricLeak = (s = '') =>
      /ASK A FOLLOW-?UP ONLY IF|GIBBERISH|LOW-?EFFORT|OFF-?BASE/i.test(s);

    const extractFirstQuestion = (s = '') => {
      // Prefer the first "?" sentence, else trim to 5–25 words
      const qIdx = s.indexOf('?');
      let candidate = qIdx >= 0 ? s.slice(0, qIdx + 1) : s;
      candidate = candidate.replace(/\s+/g, ' ').trim();
      const words = candidate.split(' ');
      if (words.length > 25) candidate = words.slice(0, 25).join(' ') + '?';
      return candidate;
    };

    const sys = [
      'You are an AI tutor for a POGIL class.',
      'Never restate or quote rubrics or instructions.',
      'Return ONLY valid JSON per the schema — no extra text.',
    ].join(' ');

    const gate = [
      'Decide whether to ask a follow-up using this gate:',
      'ASK ONLY IF one of these is true:',
      '1) OFF-BASE (unrelated/contradicts fundamentals)',
      '2) GIBBERISH / NO-ATTEMPT ("idk", empty, nonsense, copy of prompt)',
      '3) LOW-EFFORT (fewer than 5 meaningful words AND no evidence of reasoning/testing)',
      'If NONE apply — even if partially wrong — do NOT ask.',
      'Short numeric/string answers can be sufficient; do not probe those.',
    ].join(' ');

    // If you truly want to force a follow-up (rare), flip this switch here:
    const decisionHint = forceFollowup
      ? 'Set "decision":"ask".'
      : 'Set "decision":"no" if the gate does not apply.';

    const jsonSchema = [
      'Return JSON only:',
      '{"decision":"ask"|"no","question": string|null}',
      'If "decision" is "no", question MUST be null.',
      'If "decision" is "ask", question MUST be one short tutor-style question (5–25 words).',
    ].join(' ');

    const guidance = [
      guide ? `Optional guidance you MAY use: "${guide}".` : '',
      authoredGuide ? `If you do ask, you may bias toward: "${authoredGuide}" (rewrite, don’t quote).` : '',
    ].filter(Boolean).join('\n');

    const user = `
Context: ${ctx}

${gate}
${decisionHint}
${jsonSchema}

Question: ${questionText}
Student's answer: "${studentAnswer}"
Sample (ideal) answer (for your reference): "${sampleResponse}"
${guidance ? `\n${guidance}` : ''}
`.trim();

    const chat = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
      max_tokens: 150,
    });

    const raw = (chat.choices?.[0]?.message?.content ?? '').trim();

    // Try to parse JSON robustly
    let obj = null;
    try {
      // find first {...} block
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      obj = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(raw);
    } catch (_) {
      // fallback: treat as plain text
      const upper = raw.toUpperCase();
      if (/NO[_\s-]?FOLLOWUP/.test(upper) || /"decision"\s*:\s*"no"/i.test(raw)) {
        return res.json({ followupQuestion: null });
      }
      // try to extract a question
      const candidate = extractFirstQuestion(raw);
      if (!candidate || looksLikeRubricLeak(candidate)) {
        return res.json({ followupQuestion: null });
      }
      return res.json({ followupQuestion: candidate });
    }

    // Validate JSON fields
    const decision = (obj.decision || '').toLowerCase();
    let question = (obj.question ?? '');

    if (decision !== 'ask') {
      return res.json({ followupQuestion: null });
    }

    // sanitize question
    if (typeof question !== 'string') question = String(question || '');
    question = question.replace(/^["'`]+|["'`]+$/g, '').trim();
    if (!question) {
      return res.json({ followupQuestion: null });
    }
    if (looksLikeRubricLeak(question)) {
      // model echoed the rubric — discard
      return res.json({ followupQuestion: null });
    }
    // keep it short and question-y
    question = extractFirstQuestion(question);
    return res.json({ followupQuestion: question });

  } catch (err) {
    console.error('❌ Error evaluating student response:', err);
    return res.status(500).json({ error: 'OpenAI evaluation failed' });
  }
}


/**
 * ✅ Updated: Python code evaluation with better feedback sensitivity
 */
async function evaluatePythonCode(req, res) {
  const { questionText, studentCode, codeVersion, guidance = "" } = req.body;

  if (!questionText || !studentCode) {
    return res.status(400).json({ error: 'Missing question text or student code' });
  }

  try {
    const prompt = `
You are a Python tutor evaluating a student's code submission.

Activity-specific guidance for what to prioritize or ignore:
${guidance || "(no special guidance — use the default rubric)"} 

Question or task:
${questionText}

Student's code (version ${codeVersion}):
\`\`\`python
${studentCode}
\`\`\`

Evaluate the code using this order of priority:
1) Functional correctness relative to the task and the activity guidance.
2) Clear, appropriate user-facing output for this task.
3) Code clarity (names, structure) — only if relevant per the activity guidance.

If the activity guidance says to ignore or defer certain concerns (e.g., input validation), do NOT require them.

If the code meets the expectations, respond exactly: NO_FEEDBACK
Otherwise, return ONE concise, actionable suggestion (single sentence).
`.trim();


    const chat = await openai.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 150,
    });

    const raw = (chat.choices?.[0]?.message?.content ?? '').trim();
    // Normalize quotes/label and tag for NO_FEEDBACK
    const normalized = raw.replace(/^["'`]+|["'`]+$/g, '').trim();
    const tag = normalized.toUpperCase().replace(/[.\s!?]+$/g, '').replace(/[-\s]/g, '_');
    const feedback = (tag === 'NO_FEEDBACK') ? null : normalized;
    console.log('✅ Code feedback:', feedback ?? 'NO_FEEDBACK');
    res.json({ feedback });
  } catch (err) {
    console.error('Error evaluating Python code:', err);
    res.status(500).json({ error: 'AI code evaluation failed' });
  }
}


async function evaluateCode({ questionText, studentCode, codeVersion }) {
  const prompt = `
You are a Python tutor evaluating a student's code submission.

Question: ${questionText}

Student's code (version ${codeVersion}):
\`\`\`python
${studentCode}
\`\`\`

Does the code correctly and clearly meet the expected goal?

Evaluate the code based on:
- Functional correctness (does it run and solve the problem?)
- Clear and appropriate user-facing output
- Code structure and naming conventions

If the code meets **all** of these criteria, respond with: "NO_FEEDBACK".

Otherwise, return **one concise improvement suggestion**, such as fixing a bug, rephrasing unclear output, or improving readability.

Only respond with "NO_FEEDBACK" or a single suggestion.
`.trim();

  const chat = await openai.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 150,
  });

  const raw = (chat.choices?.[0]?.message?.content ?? '').trim();
  const normalized = raw.replace(/^["'`]+|["'`]+$/g, '').trim();
  const tag = normalized.toUpperCase().replace(/[.\s!?]+$/g, '').replace(/[-\s]/g, '_');
  return { feedback: (tag === 'NO_FEEDBACK') ? null : normalized };
}

module.exports = {
  evaluateStudentResponse,
  evaluatePythonCode,
  evaluateCode, // ✅ local use
};
