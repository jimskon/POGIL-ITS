// server/ai/controller.js
const OpenAI = require('openai');
require('dotenv').config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'; // keep model configurable

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

    const modeInstruction = forceFollowup
      ? `ALWAYS write exactly ONE short, concrete follow-up question tailored to THIS question and the student's answer.
         Use the authored guide if present, but DO NOT repeat it verbatim; rewrite it as a specific question.`
      : `First compare the student's answer to the sample response.
         If the answer addresses the question (not verbatim, but mostly correct), reply exactly "NO_FOLLOWUP".
         Otherwise, write exactly ONE short, concrete follow-up question tailored to THIS question and the student's answer.
         The followup question should stimulate the student's critical thinking and understanding of the topic.`;

    const guidance = [
      guide ? `Feedback guidance you MAY use: "${guide}".` : '',
      authoredGuide ? `Author's follow-up guide (do NOT echo verbatim; convert into a specific question): "${authoredGuide}".` : ''
    ].filter(Boolean).join('\n');

    const aiPrompt = `
You are an AI tutor.
Context: ${ctx}

${modeInstruction}
${guidance}

Constraints for your output:
- One sentence, 5–40 words.
- In the voice of a tutor talking to a small grouop of students.
- Refer back to the student's answer if helpful. Ask the student to elaborate on their answe if it was incomplete.
- Ask the student to consider their answer with a hint if it was completely wrong.
- Output only the question OR "NO_FOLLOWUP".

Question: ${questionText}
Student's answer: "${studentAnswer}"
Sample (ideal) answer: "${sampleResponse}"
`.trim();
    // ✅ Add console.log here
    console.log("Final AI prompt being sent:\n", aiPrompt);

    const chat = await openai.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: aiPrompt }],
      temperature: 0.3,
      max_tokens: 100,
    });
    const raw = (chat.choices?.[0]?.message?.content ?? '').trim();
    console.log('✅ OpenAI raw response:', raw);
    // Normalize: strip quotes/backticks, remove a leading "Follow-up:" label, trim.
    const normalized = raw
      .replace(/^["'`]+|["'`]+$/g, '')           // surrounding quotes
      .replace(/^follow[-\s]?up\s*:\s*/i, '')    // leading "Follow-up:" label
      .trim();
    // Canonical tag for comparison: uppercase, collapse spaces/dashes to underscores, drop trailing punctuation.
    const tag = normalized
      .toUpperCase()
      .replace(/[.\s!?]+$/g, '')                 // trailing punctuation
      .replace(/[-\s]/g, '_');                   // spaces/dashes => underscores

    if (tag === 'NO_FOLLOWUP') {
      return res.json({ followupQuestion: null });
    }
    // Return the cleaned follow-up question (without quotes/label)
    return res.json({ followupQuestion: normalized });
  } catch (err) {
    console.error('❌ Error evaluating student response:', err);
    return res.status(500).json({ error: 'OpenAI evaluation failed' });
  }
}

/**
 * ✅ Updated: Python code evaluation with better feedback sensitivity
 */
async function evaluatePythonCode(req, res) {
  const { questionText, studentCode, codeVersion } = req.body;

  if (!questionText || !studentCode) {
    return res.status(400).json({ error: 'Missing question text or student code' });
  }

  try {
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
