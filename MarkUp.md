# POGIL Markup Language Cheat Sheet 
## Document Metadata
| Syntax             | Description                          | Example                          |
|--------------------|--------------------------------------|----------------------------------|
| `\title{...}`      | Title of the activity                 | `\title{Void Functions - V2.0}` |
| `\name{...}`       | Unique identifier for the activity    | `\name{voidfunctions}`          |
| `\section{...}`    | Section heading                       | `\section{Learning Objectives}` |

## Question Groups
| Syntax                 | Description                                     | Example                            |
|------------------------|-------------------------------------------------|------------------------------------|
| `\questiongroup{...}`  | Starts a group of related questions with intro  | `\questiongroup{Explore output}`  |
| `\endquestiongroup`    | Ends a question group                           | `\endquestiongroup`               |

## Text and Formatting
| Syntax           | Description              | Example                                |
|------------------|--------------------------|----------------------------------------|
| `\text{...}`     | Plain inline paragraph   | `\text{This is an intro paragraph.}`   |
| `\textbf{...}`   | Bold inline text         | `\textbf{Content}`                     |
| `\textit{...}`   | Italic inline text       | `\textit{Remember this rule}`          |

## Lists
| Syntax               | Description              | Example                                |
|----------------------|--------------------------|----------------------------------------|
| `\begin{itemize}`    | Start bullet list        |                                        |
| `\item ...`          | List item                | `\item Reuse code`                     |
| `\end{itemize}`      | End bullet list          |                                        |
| `\begin{enumerate}`  | Start numbered list      |                                        |
| `\end{enumerate}`    | End numbered list        |                                        |

## Python Code
| Syntax        | Description                  | Example                                |
|---------------|------------------------------|----------------------------------------|
| `\python`     | Begin Python code block      | `\python`                              |
| `\endpython`  | End Python code block        | `\endpython`                           |

## Questions and Responses
| Syntax                      | Description                                                  | Example                                       |
|-----------------------------|--------------------------------------------------------------|-----------------------------------------------|
| `\question{...}`            | Start a question with inline prompt text                     | `\question{What does def mean?}`             |
| `\endquestion`              | End the current question                                     | `\endquestion`                                |
| `\textresponse{n}`          | Response box (n lines)                                       | `\textresponse{3}`                            |
| `\sampleresponses{...}`     | Inline sample response                                       | `\sampleresponses{The keyword is \`def\`.}`   |
| `\feedbackprompt{...}`      | Instructor feedback guidance.  Use "none" if you never want feedback | `\feedbackprompt{Check if they mention def}`  |
| `\followupprompt{...}`      | Follow-up prompt to ask student a deeper question            | `\followupprompt{Ask about use of def}`       |

## Hyperlinks
| Syntax                | Description             | Example                                                                            |
| --------------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| \link{URL}{Link text} | Hyperlink to a web page | \link{https://pogil.org/roles}{POGIL} |

## Images — Option A (Single-line)

| Syntax                              | Description                      | Example                                                            |
|-------------------------------------|----------------------------------|--------------------------------------------------------------------|
| `\image{URL}`                       | Image with no caption            | `\image{https://example.com/diagram.png}`                          |
| `\image{URL}{Alt or caption}`       | Image with caption               | `\image{https://example.com/diagram.png}{Program flow}`            |
| `\image{URL}{Alt}{Size}`            | Caption + width (px or %)        | `\image{https://example.com/diagram.png}{Program flow}{50%}`       |

**Notes**
- **Size** can be a number (pixels), e.g. `300`, or a percentage, e.g. `60%`.
- Allowed sources: `http(s)` and `data:image/...`.
- Google Drive links like `https://drive.google.com/file/d/<ID>/view?...` are supported (converted to a viewable URL by the renderer).
---

## Examples

### Question Example

```markdown
\question{What Python keyword is used to indicate that a code segment is a function definition?}
\textresponse{2}
\sampleresponses{The keyword is `def`.}
\feedbackprompt{Evaluate whether the student correctly identified `def` as the Python keyword to define functions.}
\followupprompt{Ask the student to explain why a keyword like `def` is needed when defining functions.}
\endquestion
```

### Question Group Example

```markdown
\questiongroup{Analyze the following Python code to answer the questions.}

\python
def greet():
    print("Hello!")
greet()
\endpython

\question{What is the name of the function?}
\textresponse{1}
\sampleresponses{greet}
\feedbackprompt{Check if the student correctly identifies the function name.}
\followupprompt{Ask why we need to define a function before calling it.}
\endquestion

\question{What is the output of this program?}
\textresponse{1}
\sampleresponses{Hello!}
\feedbackprompt{Did the student reproduce the output exactly?}
\followupprompt{What would happen if the call to `greet()` was removed?}
\endquestion

\endquestiongroup
```

### Python Example

```markdown
\python
def say_hello():
    print("Hi there!")
\endpython
```

### List and Formatting Example

```markdown
\text{Before writing a function, remember the following:}

\textbf{Steps to create a function}

\begin{enumerate}
\item Use the `def` keyword.
\item Give the function a name.
\item Add parentheses and a colon.
\item Indent the function body.
\end{enumerate}

\textit{Tip: Use meaningful function names to improve readability.}
```
# AI Guidance for This System (Authoring Cheatsheet)

| Guidance line to paste in `\aicodeguidance{...}` | Parsed flag (server) | Effect on feedback | Effect on follow-ups / gating | When to use / notes |
|---|---|---|---|---|
| **Follow-ups: none** | `followupGate = 'none'` | Model may give a 1-line hint (feedback), but **no follow-up questions** are ever shown. | **Never blocks** on follow-ups. Fatal errors still return feedback only. | Use for practice where you don’t want banners or extra questions. |
| **Follow-ups: gibberish-only** | `followupGate = 'gibberish-only'` | Normal hints allowed; nitpicks filtered by other flags. | Follow-ups shown **only** if the answer is empty/gibberish/off-base. | Matches “don’t ask followups unless gibberish or way off.” |
| **Follow-ups: default** | `followupGate = 'default'` | Normal hints allowed; nitpicks depend on other flags. | Model may ask a follow-up when it thinks it’s needed. | Stricter sessions (quizzes, checks for understanding). |
| **Do not ask a follow up.** | `followupGate = 'none'` | Same as “Follow-ups: none”. | Same as “Follow-ups: none”. | Plain-English equivalent. |
| **Requirements-only** | `requirementsOnly = true` | Filters **nitpicks**; feedback focuses on meeting the stated task only. | Combined with follow-up gate: doesn’t by itself block or allow. | Good for early courses; prevents scope creep. |
| **Checker errors should not block progress (fail-open).** | `failOpen = true` | Suppresses non-fatal nags; treats small issues as **OK**. | With `gibberish-only`, only truly bad answers get a follow-up. | Lets partially-right work pass with a light hint. |
| **Ignore spacing.** | `ignoreSpacing = true` | Hides spacing/formatting/style advice. | No effect on gating; just reduces noise. | Pair with “match sample output” only if you truly don’t care about spaces. |
| **f-strings are unavailable; do not recommend them.** | `forbidFStrings = true` | Prevents suggestions to use f-strings. | No effect on gating. | Required for your Python runtime that lacks f-strings. |
| **Do not require extra features.** | `noExtras = true` | Blocks “add feature/refactor/optimize” suggestions. | No effect on gating. | Keeps scope tight to the prompt. |
| **Match the sample output exactly (labels and order).** | *(soft guidance)* | Encourages exact output; if **also** using “Ignore spacing”, spacing still won’t be enforced. | No direct effect; combine with stricter follow-ups if you want blocking. | For exams, omit “Ignore spacing” and use `Follow-ups: default`. |
| **Use concise, single-sentence feedback only.** | *(soft guidance)* | Nudges the model to keep feedback short. | No direct effect. | Style preference; already aligned with server prompts. |
| **No follow-up unless the answer is gibberish or off-prompt.** | → Prefer **“Follow-ups: gibberish-only”** | Same as that preset. | Same as that preset. | Write the explicit preset for guaranteed behavior. |

---

## Preset Combos (copy/paste into `\aicodeguidance{...}`)

### Practice (very light touch)
    Follow-ups: gibberish-only
    Requirements-only
    Ignore spacing.
    Do not require extra features.
    f-strings are unavailable; do not recommend them.
    Checker errors should not block progress (fail-open).

### Quiz (moderate)
    Follow-ups: default
    Requirements-only
    Do not require extra features.
    f-strings are unavailable; do not recommend them.

### Exam (strict output)
    Follow-ups: default
    Match the sample output exactly (labels and order).
    Do not require extra features.
    f-strings are unavailable; do not recommend them.
