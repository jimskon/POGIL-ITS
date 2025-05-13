# 📝 POGIL Markup Language Cheat Sheet

## 🔖 Document Metadata
| Syntax             | Description                        | Example                          |
|--------------------|------------------------------------|----------------------------------|
| `\questiongroup`   | Starts a group of related questions | `\questiongroup`                |
| `\endquestiongroup`| Ends a group of related questions   | `\endquestiongroup`             |
| `\title{...}`      | Title of the activity               | `\title{Void Functions - V2.0}` |
| `\name{...}`       | Unique identifier for activity      | `\name{voidfunctions}`          |
| `\section{...}`    | Section heading                     | `\section{Learning Objectives}` |

## 🧠 Learning Objectives and Descriptive Text
| Syntax             | Description                        | Example                          |
|--------------------|------------------------------------|----------------------------------|
| `\text{...}`       | Plain paragraph text                | `\text{Students will be able to:}` |
| `\textbf{...}`     | Boldface inline text                | `\textbf{Content}`              |

## 📝 Lists
| Syntax                   | Description                       | Example                              |
|--------------------------|-----------------------------------|--------------------------------------|
| `\begin{itemize}`        | Starts a bullet list              |                                      |
| `\item ...`              | Bullet point                      | `\item Explain the meaning...`       |
| `\end{itemize}`          | Ends bullet list                  |                                      |
| `\begin{enumerate}`      | Starts a numbered list            |                                      |
| `\end{enumerate}`        | Ends numbered list                |                                      |

## 🐍 Python Code
| Syntax        | Description                      | Example                     |
|---------------|----------------------------------|-----------------------------|
| `\python`     | Starts a Python code block       | `\python`                   |
| `\endpython`  | Ends a Python code block         | `\endpython`                |

## ❓ Questions and Responses
| Syntax                 | Description                                             | Example                                       |
|------------------------|---------------------------------------------------------|-----------------------------------------------|
| `\question`            | Begins a question                                       | `\question`                                   |
| `\endquestion`         | Ends a question                                         | `\endquestion`                                |
| `\textresponse{n}`     | Text area for student response (n = # lines)            | `\textresponse{3}`                            |
| `\sampleresponses`     | Starts block of sample responses                        | `\sampleresponses`                            |
| `\endsampleresponses`  | Ends block of sample responses                          | `\endsampleresponses`                         |
| `\feedbackprompt`      | Starts feedback guidance for instructors                | `\feedbackprompt`                             |
| `\endfeedbackprompt`   | Ends feedback guidance                                  | `\endfeedbackprompt`                          |
| `\followupprompt`      | Starts follow-up question prompt                        | `\followupprompt`                             |
| `\endfollowupprompt`   | Ends follow-up prompt                                   | `\endfollowupprompt`                          |

## 🧪 Examples

### Question Example
```
\question
What is the purpose of a function in Python?
\textresponse{3}

\sampleresponses
To avoid repeating code and organize logic.
\endsampleresponses

\feedbackprompt
Evaluate whether the student explains reuse and structure benefits.
\endfeedbackprompt

\followupprompt
Ask the student to provide an example of function reuse.
\endfollowupprompt
\endquestion
```

### Code Block Example
```
\python
def greet():
    print("Hello!")

greet()
\endpython
```

## ✅ Notes
- All environments like `\begin{itemize}` must be properly closed with `\end{itemize}`.
- All questions are self-contained within `\question` and `\endquestion`.
- Question groups should be wrapped in `\questiongroup` and `\endquestiongroup`.
- Document begins with metadata using `\title`, `\name`, and `\section`.
