# coLearn-AI / POGIL Markup Language Cheat Sheet

Full Specification

---

## Overview

This markup defines how to author interactive activities for coLearn-AI.

The system supports:

- Collaborative learning mode (AI-guided)
- Playground mode (no AI blocking, "Next" progression)
- Test / quiz mode (graded)
- Runnable Python blocks (with optional timeout and imports)
- Runnable C++ blocks (with optional timeout)
- Runnable Python Turtle blocks (with window size + timeout)
- Editable file blocks
- Structured AI feedback directives
- Structured scoring rubrics
- Retry policies at sheet or group level
- Tables with editable cells
- Images (with captions and width control)
- Hyperlinks
- Included support files for code execution

All interactive content must appear inside a `\questiongroup`.

---

## 1. Document Metadata

| Syntax | Description | Example |
|--------|-------------|---------|
| `\title{...}` | Activity display title | `\title{Greedy Algorithms Quiz}` |
| `\name{...}` | Unique internal identifier | `\name{greedyquiz}` |
| `\studentlevel{...}` | Target audience | `\studentlevel{Second Year}` |
| `\activitycontext{...}` | Introductory paragraph | `\activitycontext{This activity explores...}` |
| `\aicodeguidance{...}` | Global AI behavior rules | See AI Guidance section below |
| `\mode{normal\|playground\|test}` | Activity mode | `\mode{playground}` |
| `\test` | Marks activity as graded assessment | `\test` |
| `\retries{n}` | Default retry policy for all groups | `\retries{3}` |
| `\section{...}` | Structural heading (non-interactive) | `\section{Introduction}` |

Notes:

- `\mode{playground}` enables playground behavior.
- Valid modes are `normal`, `playground`, and `test`.
- `\mode{test}` and `\test` are equivalent.
- `\retries{n}` outside groups sets the sheet-wide default retry count.
- `\section` is structural only.

---

## 2. Question Groups

```text
\questiongroup{Greedy Algorithms}
...
\endquestiongroup
```

| Syntax | Description | Example |
|--------|-------------|---------|
| `\questiongroup{...}` | Starts a group of related questions | `\questiongroup{Greedy Algorithms}` |
| `\endquestiongroup` | Ends the group | `\endquestiongroup` |
| `\retries{n}` | Overrides retry count for this group (must appear before questions) | `\retries{2}` |

Notes:

- All answerable items (`\question`, `\textresponse`, code blocks, file blocks, tables) must be inside a `\questiongroup`.
- A group-level `\retries{n}` overrides the sheet default.
- `\retries{n}` inside a question is ignored.

---

## 3. Questions and Responses

```text
\question{What is a greedy algorithm?}
\textresponse{4}
\endquestion
```

| Syntax | Description | Example |
|--------|-------------|---------|
| `\question{...}` | Begins a question | `\question{Explain Dijkstra’s algorithm.}` |
| `\endquestion` | Ends the question (required) | `\endquestion` |
| `\textresponse{n}` | Student response box (n lines tall) | `\textresponse{5}` |
| `\sampleresponses{...}` | Sample instructor solution (hidden) | `\sampleresponses{Chooses a local optimum.}` |
| `\feedbackprompt{...}` | AI grading guidance | `\feedbackprompt{Encourage elaboration.}` |
| `\followupprompt{...}` | Optional AI follow-up hint | `\followupprompt{Why might greedy fail?}` |

Every `\question` must explicitly end with `\endquestion`.

---

## 4. Scoring Blocks (Assessment Mode)

```text
\score{6,response}
6: Clear, correct explanation with example
3-5: Mostly correct
1-2: Partial understanding
0: Incorrect or missing
\endscore
```

### Scoring Syntax

| Syntax | Description | Example |
|--------|-------------|---------|
| `\score{points,type}` | Begins grading rubric | `\score{5,response}` |
| `\endscore` | Ends scoring block | `\endscore` |

### Meaning of `type`

| Type | Meaning | Example |
|------|---------|---------|
| `response` | Written answer | `\score{6,response}` |
| `code` | Student-written code | `\score{10,code}` |
| `output` | Program output | `\score{4,output}` |

Notes:

- Scoring is controlled only by `\score{}` blocks.
- Used primarily in test mode.

---

## 5. Lists

```text
\begin{itemize}
\item First item
\item Second item
\end{itemize}

\begin{enumerate}
\item Step one
\item Step two
\end{enumerate}
```

Nested lists are not supported reliably in current sheet rendering.

---

## 6. Text Formatting

| Syntax | Description | Example |
|--------|-------------|---------|
| `\text{...}` | Paragraph text | `\text{This is a paragraph.}` |
| `\textbf{...}` | Bold text | `\textbf{Important}` |
| `\textit{...}` | Italic text | `\textit{Optional}` |
| `\texttt{...}` | Monospace inline text | `\texttt{count++}` |
| `\mono{...}` | Monospace formatted text | `\mono{for i in range(5):}` |

---

## 7. Tables

```text
\table{Example Table}
\row Name & Age & Major
\row Alice & 20 & \tresponse
\row Bob & 21 & Computer Science
\endtable
```

| Syntax | Description | Example |
|--------|-------------|---------|
| `\table{caption}` | Begins table | `\table{Student Data}` |
| `\row ...` | Defines row (cells separated by `&`) | `\row Alice & 20 & CS` |
| `\endtable` | Ends table | `\endtable` |
| `\tresponse` | Editable cell marker | `\row Alice & 20 & \tresponse` |

---

## 8. File Blocks

```text
\file{sports.txt}
Lions
Tigers
Bears
\endfile
```

| Syntax | Description | Example |
|--------|-------------|---------|
| `\file{filename}` | Begins an editable file block | `\file{input.txt}` |
| `\endfile` | Ends the file block | `\endfile` |

Notes:

- File blocks should be inside question groups.
- These integrate with code execution environments.

---

## 9. Included Support Files

```text
\include{helper.py,data.txt}
\python
print("hello")
\endpython
```

| Syntax | Description | Example |
|--------|-------------|---------|
| `\include{file1,file2,...}` | Attaches support files to the next code block | `\include{helper.py,data.csv}` |

Notes:

- Applies to the next code block only.

---

## 10. Code Blocks

### Python

```text
\python
# code here
\endpython
```

```text
\python{50000}
# code here
\endpython
```

```text
\python{50000,imports=math,random}
# code here
\endpython
```

| Syntax | Description | Example |
|--------|-------------|---------|
| `\python` | Default Python block | |
| `\python{timeout}` | Timeout in ms | `\python{50000}` |
| `\python{timeout,imports=...}` | Timeout + imports | |
| `\endpython` | Ends Python block | |

---

### C++

```text
\cpp
#include <iostream>
int main() { }
\endcpp
```

```text
\cpp{50000}
#include <iostream>
int main() { }
\endcpp
```

| Syntax | Description |
|--------|------------|
| `\cpp` | Default C++ block |
| `\cpp{timeout}` | Timeout in ms |
| `\endcpp` | Ends block |

---

## 11. Python Turtle

```text
\pythonturtle{900x600,50000}
# turtle code here
\endpythonturtle
```

| Syntax | Description |
|--------|------------|
| `\pythonturtle{WxH,timeout}` | Window size + timeout |
| `\endpythonturtle` | Ends block |

---

## 12. Images

```text
\image{URL}
\image{URL}{Caption}
\image{URL}{Caption}{50%}
```

---

## 13. Hyperlinks

```text
\link{URL}{Text}
```

---

## Core Design Principles

1. All interactive content must be inside `\questiongroup`.
2. Every `\question` must end with `\endquestion`.
3. Learning mode uses AI guidance.
4. Playground mode removes blocking and AI enforcement.
5. Test mode is strictly graded.
6. Retry behavior is controlled by `\retries{n}`.
7. AI responds only to student submissions.
8. Python Turtle is a first-class environment.
9. Avoid nested lists.