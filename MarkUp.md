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
| `\feedbackprompt{...}`      | Instructor feedback guidance                                 | `\feedbackprompt{Check if they mention def}`  |
| `\followupprompt{...}`      | Follow-up prompt to ask student a deeper question            | `\followupprompt{Ask about use of def}`       |

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
