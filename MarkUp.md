# POGIL Markup Language Cheat Sheet (Updated with Test + Scoring Tags)

## Document Metadata
| Syntax             | Description                                  | Example                          |
|--------------------|----------------------------------------------|----------------------------------|
| `\title{...}`      | Title of the activity                         | `\title{Greedy Algorithms Quiz}` |
| `\name{...}`       | Unique ID/name for the activity               | `\name{greedyquiz}`             |
| `\studentlevel{...}` | Target student audience                    | `\studentlevel{Second Year}`     |
| `\activitycontext{...}` | Intro paragraph for students           | `\activitycontext{This quiz…}`   |
| `\aicodeguidance{...}` | Instructions for the AI scoring engine | See AI Guidance section below    |
| `\test`            | Marks activity as an **assessment** (quiz/test — no student hints) | `\test` |

---

## Question Groups
| Syntax                 | Description                                     | Example                            |
|------------------------|-------------------------------------------------|------------------------------------|
| `\questiongroup{...}`  | Starts a group of related questions             | `\questiongroup{Greedy Algorithms}`|
| `\endquestiongroup`    | Ends the group                                   | `\endquestiongroup`               |

**Important:**  
All answerable items (`\question`, `\textresponse`, code blocks) must be inside a `\questiongroup` to be editable in RunActivity.

---

## Questions and Responses
| Syntax                      | Description                                                  | Example                                       |
|-----------------------------|--------------------------------------------------------------|-----------------------------------------------|
| `\question{...}`            | Start a question; ends at `\endquestion`                     | `\question{What is a greedy algorithm?}`      |
| `\endquestion`              | Ends the question, required if additional blocks follow      | `\endquestion`                                |
| `\textresponse{n}`          | Student response box (n lines tall)                          | `\textresponse{4}`                            |
| `\sampleresponses{...}`     | Sample instructor solution (hidden from students)            | `\sampleresponses{It chooses a local optimum.}` |
| `\feedbackprompt{...}`      | AI grading guidance                                          | `\feedbackprompt{Check that they describe local choice.}` |
| `\followupprompt{...}`      | AI follow-up hint (suppressed during tests)                  | `\followupprompt{Ask why local isn't always global.}` |

---

## Scoring Blocks (NEW SECTION)

### Purpose
`\score` blocks define how the AI grades a question in a quiz or test.  
They always appear **after** the question they apply to.

### Syntax

| Syntax                  | Description                               | Example |
|-------------------------|-------------------------------------------|---------|
| `\score{points,type}`   | Begins a scoring rubric                   | `\score{6,response}` |
| `\endscore`             | Ends the scoring block                    | `\endscore` |

### Meaning of `type`

| Type        | Meaning                                      |
|-------------|------------------------------------------------|
| `response`  | Scores a written text response                |
| `code`      | Scores a student-written code block           |
| `output`    | Scores output from a demo/test program        |
| Other text  | Treated as custom metadata                    |

### Example Scoring Block

```
\score{5,response}
Grade the student’s explanation.

Rubric:
  - 5 points: Clear, correct, with example.
  - 3–4 points: Mostly correct.
  - 1–2 points: Some understanding but unclear.
  - 0 points: Incorrect or missing.
\endscore
```

---

## Lists
| Syntax               | Description              |
|----------------------|--------------------------|
| `\begin{itemize}`    | Begin bullet list        |
| `\item ...`          | Bullet item              |
| `\end{itemize}`      | End bullet list          |
| `\begin{enumerate}`  | Begin numbered list      |
| `\end{enumerate}`    | End numbered list        |

---

## Text and Formatting
| Syntax           | Description              |
|------------------|--------------------------|
| `\text{...}`     | Paragraph (supports inline formatting) |
| `\textbf{...}`   | Bold text                |
| `\textit{...}`   | Italic text              |

---

## Tables
A table is defined with `\table{caption}` and `\endtable`.

### Structure

```
\table{Example Table}
\row Name & Age & Major
\row Alice & 20 & \tresponse
\row Bob & 21 & Computer Science
\endtable
```

Notes:
- Each `\row` defines a row.
- Cells are separated with `&`.
- All rows should have the same number of cells.
- You may use `\tresponse` inside any cell.

---

## Code Blocks

### Python
Supports optional timeout: `\python{50000}`
```
\python
# code here
\endpython
```

### C++  
Supports optional timeout: `\cpp{50000}`

```
\cpp
#include <iostream>
int main() { }
\endcpp
```

### File Blocks

```
\file{utils.hpp,readonly}
// contents here
\endfile
```

Flags:
- `readonly` prevents editing.

---

## Images
```
\image{URL}
\image{URL}{Caption}
\image{URL}{Caption}{50%}
```

- Width can be a percentage or pixel value.
- Google Drive links are auto-coerced.

---

## Hyperlinks
```
\link{URL}{Text}
```

---

## AI Guidance (Server Behavior Settings)

Place these inside:

```
\aicodeguidance{
   ...
}
```

### Follow-up Behavior

| Directive                         | Effect |
|----------------------------------|--------|
| `Follow-ups: none`               | No follow-up questions ever. |
| `Follow-ups: gibberish-only`     | Follow-ups only for empty/off-track answers. |
| `Follow-ups: default`            | AI may ask follow-up questions. |

### Other AI Flags

| Directive                                   | Effect |
|----------------------------------------------|--------|
| `Requirements-only`                          | Score only stated requirements; no scope creep. |
| `Ignore spacing.`                            | Ignore whitespace differences. |
| `Checker errors should not block progress.`  | Fail-open mode. |
| `Do not require extra features.`             | Prevents feature creep. |
| `f-strings are unavailable; do not recommend them.` | Blocks f-string suggestions. |

### Example AI Guidance Block

```
\aicodeguidance{
    Follow-ups: gibberish-only
    Requirements-only
    Ignore spacing.
    Do not require extra features.
    f-strings are unavailable; do not recommend them.
    Checker errors should not block progress.
}
```

## Question-Level AI Semantics (Learning Mode)

coLearn-AI distinguishes **learning-oriented feedback** from **grading**.

The following question-level tags are used **only for ungraded, collaborative learning activities**.

Grading behavior is controlled *exclusively* by the `\score{}` tag and related test / quiz logic.

---

## Overview

Each question may optionally define:

- `\sampleresponses{...}` — what acceptable answers look like
- `\feedbackprompt{...}` — how and when to respond during learning
- `\followupprompt{...}` — how to extend thinking after an initial response

These tags **do not assign correctness or scores**.  
They guide *interpretation, encouragement, and interaction*.

---

## `\sampleresponses{...}` — Acceptance Envelope

Defines examples and constraints for what counts as an acceptable response.

### Purpose

- Describe *likely or representative answers*
- Define acceptable ranges, equivalences, or conceptual targets
- Help the AI judge whether a response is “on track”

### May include

- Concrete example answers
- Conceptual descriptions of what a good answer involves
- Ranges or tolerances (e.g. “Any rotation roughly between 40–50 degrees”)
- Multiple acceptable approaches

### Rules

- Never quoted verbatim to students
- Used only as internal guidance for evaluating *plausibility and relevance*
- Does **not** imply a single correct answer

### Example
```
\sampleresponses{
Any solution that rotates the square before drawing.
Angles roughly between 40–50 degrees are acceptable.
Equivalent approaches that produce a rotated square are fine.
}
```

---

## `\feedbackprompt{...}` — Learning Feedback Policy

Describes **how and when** feedback should be given during the activity.

This is **meta-guidance**, not a hint script.

### Purpose

- Specify what to encourage or reinforce
- Describe how to respond to vague, partial, or near-miss answers
- Clarify whether approximation is acceptable
- Indicate when *no feedback* is needed

### May include

- “Any coherent response is fine”
- “Encourage elaboration if under 5–6 words”
- “If stuck, suggest experimenting rather than giving the answer”
- “Focus on conceptual understanding, not syntax”

### Rules

- Never quoted verbatim to students
- Treated as *policy*, not content
- Must not override what is actually present in the student’s response or code

### Example
```
\feedbackprompt{
Any coherent attempt is acceptable.
If the answer is vague, encourage one more concrete observation.
If groups are stuck, suggest experimenting with one number at a time.
}
```

---

## `\followupprompt{...}` — Optional Engagement Extension

Defines an optional follow-up question to **extend thinking**, even after an acceptable response.

### Purpose

- Promote reflection, prediction, or transfer
- Encourage discussion beyond the minimum required answer
- Support exploration rather than correction

### Used when

- The initial response is acceptable
- The activity benefits from deeper engagement
- Additional interaction is pedagogically valuable

### Rules

- Optional — may be omitted entirely
- Should be short and open-ended
- Should not imply the original answer was wrong

### Example
```
\followupprompt{
Why does rotating before drawing change the shape’s orientation?
}
```

---

## Design Principles

- These tags support **learning**, not grading
- They guide *interpretation and interaction*, not correctness
- Instructor scaffolding must never replace reading the student’s actual work
- AI feedback must always be grounded in what the student submitted

---

## Relationship to Grading

- **Grading is controlled only by `\score{}` and test / quiz logic**
- Learning activities using these tags are **never graded**
- No scoring language (“correct”, “wrong”, points) should appear in learning feedback


