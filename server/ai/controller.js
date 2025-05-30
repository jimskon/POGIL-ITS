const { OpenAI } = require('openai');
require('dotenv').config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function evaluateStudentResponse(req, res) {
  const {
    questionText,
    studentAnswer,
    sampleResponse,
    feedbackPrompt,
    followupPrompt,
    context = {}
  } = req.body;

  if (!questionText || !studentAnswer || !followupPrompt) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const prompt = `
You are an AI tutor evaluating a student's short answer to a programming question.
Context: ${context.activityTitle || 'Unnamed Activity'} (${context.studentLevel || 'intro level'})

Question: ${questionText}

Student's answer:
"${studentAnswer}"

Sample response (ideal): 
"${sampleResponse}"

Guidance for evaluation: ${feedbackPrompt || 'N/A'}

If the student’s answer is complete and clearly meets the learning objective, respond with:
"NO_FOLLOWUP"

If the answer is unclear, missing key details, or would benefit from elaboration, respond with a follow-up question the tutor could ask.
Follow-up prompt to guide your question: ${followupPrompt}

Return only the follow-up question or "NO_FOLLOWUP".
    `.trim();

    const chat = await openai.chat.completions.create({
      model: 'gpt-4-turbo',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 100,
    });
    console.log('✅ OpenAI response:', chat.choices[0].message.content.trim());
    const result = chat.choices[0].message.content.trim();
    if (result === 'NO_FOLLOWUP') {
      return res.json({ followupQuestion: null });
    } else {
      return res.json({ followupQuestion: result });
    }
  } catch (err) {
    console.error('❌ Error evaluating student response:', err);
    return res.status(500).json({ error: 'OpenAI evaluation failed' });
  }
}

module.exports = { evaluateStudentResponse };
