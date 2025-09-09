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
    sampleResponse = "",
    feedbackPrompt = "",
    followupPrompt = "",
    forceFollowup = false,
    context = {},
    guidance = ""
  } = req.body || {};

  // ✅ Fail-open guard: if inputs are missing, do NOT block progress
  if (!questionText || !studentAnswer) {
    return res.status(200).json({
      followupQuestion: null,
      meta: { reason: 'missing_fields' }
    });
  }

  try {
    const ctx = `${context.activityContext || context.activitycontext || 'Unnamed Activity'} (${context.studentLevel || 'intro level'})`;
    const guide = (feedbackPrompt && feedbackPrompt.toLowerCase() !== 'none') ? feedbackPrompt : '';
    const authoredGuide = (followupPrompt || '').trim();
    const activityGuide = (guidance || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[^>]+>/g, '');

    const sys = [
      'You are an AI tutor for a POGIL class.',
      activityGuide ? `Activity-level guidance (DO NOT quote to the student):\n${activityGuide}` : '',
      'Do not invent new requirements that are not explicitly in the question or guidance.',
      'If the student’s answer already satisfies the task, do not ask a follow-up.',
      'Return ONLY valid JSON per the schema — no extra text.',
    ].filter(Boolean).join('\n');

    const gate = [
      'Decide whether to ask a follow-up using this gate:',
      'ASK ONLY IF one of these is true:',
      '1) OFF-BASE (unrelated/contradicts fundamentals)',
      '2) GIBBERISH / NO-ATTEMPT ("idk", empty, nonsense, copy of prompt)',
      '3) LOW-EFFORT (fewer than 5 meaningful words AND no evidence of reasoning/testing)',
      'If NONE apply — even if partially wrong — do NOT ask.',
      'Short numeric/string answers can be sufficient; do not probe those.',
    ].join(' ');

    const decisionHint = forceFollowup
      ? 'Set "decision":"ask".'
      : 'Set "decision":"no" if the gate does not apply.';

    const jsonSchema = [
      'Return JSON only:',
      '{"decision":"ask"|"no","question": string|null}',
      'If "decision" is "no", question MUST be null.',
      'If "decision" is "ask", question MUST be one short tutor-style question (5–25 words).',
    ].join(' ');

    const extraGuidance = [
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
${extraGuidance ? `\n${extraGuidance}` : ''}
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
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    let obj;
    try {
      obj = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(raw);
    } catch {
      // If we can’t parse, just don’t ask a follow-up
      return res.status(200).json({ followupQuestion: null, meta: { reason: 'unparsable' } });
    }

    if ((obj.decision || '').toLowerCase() !== 'ask') {
      return res.status(200).json({ followupQuestion: null });
    }

    let question = (obj.question ?? '').toString().trim();
    if (!question) return res.status(200).json({ followupQuestion: null });

    // Keep it short and ensure it ends at the first '?'
    const qIdx = question.indexOf('?');
    if (qIdx >= 0) question = question.slice(0, qIdx + 1);
    const words = question.split(/\s+/);
    if (words.length > 25) question = words.slice(0, 25).join(' ') + '?';

    return res.status(200).json({ followupQuestion: question });

  } catch (err) {
    // 🔥 Log details, but DO NOT block progress
    try {
      console.error('❌ OpenAI evaluate-response failed:', {
        status: err?.status,
        message: err?.message,
        code: err?.error?.code,
        type: err?.error?.type,
        details: err?.error?.message || err?.stack
      });
    } catch (_) {
      console.error('❌ OpenAI evaluate-response failed (raw):', err);
    }

    // ✅ Fail-open: no follow-up so the UI can advance
    return res.status(200).json({
      followupQuestion: null,
      meta: { reason: 'ai_unavailable' }
    });
  }
}



/**
 * ✅ Updated: Python code evaluation with better feedback sensitivity
 */
// server/ai/controller.js
async function evaluatePythonCode(req, res) {
  const { questionText, studentCode, codeVersion, guidance = "", isCodeOnly = false } = req.body;

  if (!questionText || !studentCode) {
    return res.status(400).json({ error: 'Missing question text or student code' });
  }

  const prompt = `
You are a Python tutor evaluating a student's code.

Guidance to prioritize:
${guidance || "(none)"}

Task:
${questionText}

Student's code (v${codeVersion}):
\`\`\`python
${studentCode}
\`\`\`

Return STRICT JSON with exactly these keys:
{"feedback": string|null, "followup": string|null}

Rules:
- If the code is fully correct and appropriate: feedback=null, followup=null.
- Otherwise:
  - "feedback" = ONE concise, actionable suggestion (single sentence).
  - "followup" = 
      ${isCodeOnly ? 'ONE short tutor-style question (5–20 words) that nudges the student toward the fix.' : 'null (because this is not a code-only answer).'}
- Never include rubric text or meta-instructions in your outputs.
`.trim();

  try {
    const chat = await openai.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 180,
    });

    const raw = (chat.choices?.[0]?.message?.content ?? '').trim();
    // Parse JSON robustly
    const match = raw.match(/\{[\s\S]*\}/);
    const obj = match ? JSON.parse(match[0]) : JSON.parse(raw);

    // Harden fields
    const feedback = obj.feedback == null || String(obj.feedback).trim() === '' ? null : String(obj.feedback).trim();
    const followup = obj.followup == null || String(obj.followup).trim() === '' ? null : String(obj.followup).trim();

    return res.json({ feedback, followup });
  } catch (err) {
    console.error('Error evaluating Python code:', err);
    return res.status(500).json({ error: 'AI code evaluation failed' });
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
  console.log('🤖 Code evaluation prompt:', prompt);
  const chat = await openai.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
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
