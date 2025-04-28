# POGIL-ITS Activity Markup Language — Cheat Sheet (v2.0)

## Activity Metadata
| Tag | Purpose |
|:---|:---|
| `\title{}` | Set the title of the activity. |
| `\name{}` | Internal short name (no spaces). |

## Sections
| Tag | Purpose |
|:---|:---|
| `\section{}` | Start a major instructional section. |

Inside a section:
| Tag | Purpose |
|:---|:---|
| `\begin{content}` / `\end{content}` | Main instructional text and examples. |
| `\begin{process}` / `\end{process}` | Process instructions for students. |
| `\begin{knowledge}` / `\end{knowledge}` | Prior knowledge students should have. |

## Lists
| Tag | Purpose |
|:---|:---|
| `\begin{itemize}` / `\end{itemize}` | Bullet point list. |
| `\begin{enumerate}` / `\end{enumerate}` | Numbered list. |
| `\item` | Create an item in a list. |

## Roles
| Tag | Purpose |
|:---|:---|
| `\roles` | Define student roles or prior knowledge. (Usually followed by a `\begin{knowledge}` block.) |

## Questions
| Tag | Purpose |
|:---|:---|
| `\begin{question}{qID}` | Start a new question block with unique ID (e.g., q1, q2a). |
| `\textresponse{qID,fieldID}` | Mark where the student types their answer. |
| `\sampleresponses` / `\endsampleresponses` | Provide sample correct answers. |
| `\feedbackprompt` / `\endfeedbackprompt` | Give AI instructions for assessing the response. |
| `\followupprompt` / `\endfollowupprompt` | (Optional) Suggest AI follow-up prompts. |
| `\end{question}` | End the question block. |

## Code Blocks
| Tag | Purpose |
|:---|:---|
| `\python` / `\endpython` | Embed a Python code block for students to read or run. |

## Text Formatting
| Tag | Purpose |
|:---|:---|
| `\textit{}` | Italicize text. |
| `\textbf{}` | Bold text. |

## Student Workflow
When students submit a question group:
- AI checks the response using `\sampleresponses`.
- AI provides feedback using `\feedbackprompt`.
- AI optionally uses the `\followupprompt` to deepen learning.
- Students may revise or move forward.

## Example Skeleton
```
\title{Sample Activity} \name{sample_1}

\section{Learning Objectives} \begin{content} \begin{itemize} \item Understand basic logic. \item Identify propositions. \end{itemize} \end{content}

\roles \begin{knowledge} \begin{itemize} \item Basic understanding of sentences. \end{itemize} \end{knowledge}

\section{What is a Proposition?} \begin{content} A proposition is a sentence that is either true or false. \end{content}

\begin{question}{q1} Is "The sky is blue." a proposition?

\textresponse{q1,1}

\sampleresponses Yes, because it is either true or false. \endsampleresponses

\feedbackprompt Evaluate if the student correctly identified it as a proposition. \endfeedbackprompt

\followupprompt Ask the student for another example of a proposition. \endfollowupprompt

\end{question}
```

## Quick Reminders
- Always use `\begin{content}` and `\end{content}` inside sections.
- Always wrap each question inside `\begin{question}` and `\end{question}`.
- Lists must use `\begin{itemize}` or `\begin{enumerate}` around `\item`s.
- Code blocks must use `\python` and `\endpython`.

## Future Extensions
Planned tags for future support:
| Tag | Purpose |
|:---|:---|
| `\mcquestion{}` | Multiple-choice questions. |
| `\checkboxquestion{}` | Checkbox selection questions. |
| `\codeanswer{}` | Code submission input areas. |
| `\java`, `\cpp`, etc. | More code language blocks. |
| `\points{}` | Optional points annotations. |

## Status
| Feature | Status |
|:---|:---|
| Text activities with formatting | ✅ |
| Grouping, numbering, and IDs | ✅ |
| AI evaluation and feedback system | ✅ |
| Database / HTML output compatible | ✅ |
| Expandable for future question types | 🚀 |

## License
POGIL-ITS Markup Language © 2025 — Open specification for educational use.
