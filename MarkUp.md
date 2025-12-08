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

---

This is the full cheat sheet **in raw Markdown form**, exactly as requested.

If you want, I can also generate:

- A compact one-page PDF version  
- A GitHub README version  
- A version with examples for every tag  
- A validator script that checks POGIL markup for structural issues (missing questiongroups, unclosed tags, etc.)

Just say the word.
