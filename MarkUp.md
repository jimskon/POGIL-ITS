# 📝 POGIL Markup Language Cheat Sheet 
## 🔖 Document Metadata
| Syntax             | Description                          | Example                          |
|--------------------|--------------------------------------|----------------------------------|
| `\title{...}`      | Title of the activity                 | `\title{Void Functions - V2.0}` |
| `\name{...}`       | Unique identifier for the activity    | `\name{voidfunctions}`          |
| `\section{...}`    | Section heading                       | `\section{Learning Objectives}` |

## 📦 Blocks and Structure
| Syntax                 | Description                                     | Example                            |
|------------------------|-------------------------------------------------|------------------------------------|
| `\block`               | Starts a content-only section (not a group)     | `\block`                           |
| `\endblock`            | Ends a content block                            | `\endblock`                        |
| `\questiongroup{...}`  | Starts a group of related questions with intro  | `\questiongroup{Explore output}`  |
| `\endquestiongroup`    | Ends a question group                           | `\endquestiongroup`               |

## 🧠 Text and Formatting
| Syntax           | Description              | Example                                |
|------------------|--------------------------|----------------------------------------|
| `\text{...}`     | Plain inline paragraph   | `\text{This is an intro paragraph.}`   |
| `\textbf{...}`   | Bold inline text         | `\textbf{Content}`                     |
| `\textit{...}`   | Italic inline text       | `\textit{Remember this rule}`          |

## 📝 Lists
| Syntax               | Description              | Example                                |
|----------------------|--------------------------|----------------------------------------|
| `\begin{itemize}`    | Start bullet list        |                                        |
| `\item ...`          | List item                | `\item Reuse code`                     |
| `\end{itemize}`      | End bullet list          |                                        |
| `\begin{enumerate}`  | Start numbered list      |                                        |
| `\end{enumerate}`    | End numbered list        |                                        |

## 🐍 Python Code
| Syntax        | Description                  | Example                                |
|---------------|------------------------------|----------------------------------------|
| `\python`     | Begin Python code block      | `\python`                              |
| `\endpython`  | End Python code block        | `\endpython`                           |

## ❓ Questions and Responses
| Syntax                      | Description                                                  | Example                                       |
|-----------------------------|--------------------------------------------------------------|-----------------------------------------------|
| `\question{...}`            | Start a question with inline prompt text                     | `\question{What does def mean?}`             |
| `\endquestion`              | End the current question                                     | `\endquestion`                                |
| `\textresponse{n}`          | Response box (n lines)                                       | `\textresponse{3}`                            |
| `\sampleresponses{...}`     | Inline sample response                                       | `\sampleresponses{The keyword is \`def\`.}`   |
| `\feedbackprompt{...}`      | Instructor feedback guidance                                 | `\feedbackprompt{Check if they mention def}`  |
| `\followupprompt{...}`      | Follow-up prompt to ask student a deeper question            | `\followupprompt{Ask about use of def}`       |

---

## 🧪 Examples

### ✅ Question Example
