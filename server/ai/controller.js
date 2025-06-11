const { OpenAI } = require("openai");
require("dotenv").config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function evaluateStudentResponse(req, res) {
  const {
    questionText,
    studentAnswer,
    sampleResponse,
    feedbackPrompt,
    followupPrompt,
    context = {},
  } = req.body;

  if (!questionText || !studentAnswer || !followupPrompt) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const io = req.app.get("io"); // access the socket instance
  const { groupId } = context; // frontend must pass this

  try {
    const prompt = `
You are an AI tutor evaluating a student's short answer to a programming question.
Context: ${context.activityTitle || "Unnamed Activity"} (${
      context.studentLevel || "intro level"
    })

Question: ${questionText}

Student's answer:
"${studentAnswer}"

Sample response (ideal): 
"${sampleResponse}"

Guidance for evaluation: ${feedbackPrompt || "N/A"}

If the student’s answer is complete and clearly meets the learning objective, respond with:
"NO_FOLLOWUP"

If the answer is unclear, missing key details, or would benefit from elaboration, respond with a follow-up question the tutor could ask.
Follow-up prompt to guide your question: ${followupPrompt}

Return only the follow-up question or "NO_FOLLOWUP".
    `.trim();

    const chat = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 100,
    });

    const result = chat.choices[0].message.content.trim();
    const followupQuestion = result === "NO_FOLLOWUP" ? null : result;

    // ✅ Broadcast to socket group
    if (io && groupId) {
      io.to(`group-${groupId}`).emit("aiFollowupFeedback", {
        questionText,
        followupQuestion,
      });
    }

    return res.json({ followupQuestion });
  } catch (err) {
    console.error("❌ Error evaluating student response:", err);
    return res.status(500).json({ error: "OpenAI evaluation failed" });
  }
}

module.exports = { evaluateStudentResponse };
