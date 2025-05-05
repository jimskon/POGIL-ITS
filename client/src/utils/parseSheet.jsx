// utils/parseSheet.js
import ActivityQuestionBlock from '../components/activity/ActivityQuestionBlock';
import ActivityHeader from '../components/activity/ActivityHeader';
import ActivityEnvironment from '../components/activity/ActivityEnvironment';
import ActivityPythonBlock from '../components/activity/ActivityPythonBlock';

export function parseSheetToBlocks(lines) {
  console.log("🧑‍💻 parseSheetToBlocks invoked");
  const blocks = [];
  let groupNumber = 0;
  let questionLetterCode = 97;
  let responseId = 1;

  let currentQuestion = null;
  let currentField = 'prompt';
  let currentBlock = [];
  let currentGroupIntro = null;

  let inList = false;
  let listType = null;
  let listItems = [];

  const flushCurrentBlock = () => {
    if (currentBlock.length > 0) {
      blocks.push({
        type: 'text',
        content: currentBlock.join(' ').trim()
      });
      currentBlock = [];
    }
  };

  const format = (text) =>
    text
      .replace(/\\textbf\{(.+?)\}/g, '<strong>$1</strong>')
      .replace(/\\textit\{(.+?)\}/g, '<em>$1</em>')
      .replace(/\\text\{(.+?)\}/g, '$1');

  for (let line of lines) {
    const trimmed = line.trim();
    console.log("Processing line:", trimmed);

    // --- Lists ---
    if (trimmed === '\\begin{itemize}' || trimmed === '\\begin{enumerate}') {
      inList = true;
      listType = trimmed.includes('itemize') ? 'ul' : 'ol';
      listItems = [];
      continue;
    }

    if (trimmed === '\\end{itemize}' || trimmed === '\\end{enumerate}') {
      blocks.push({
        type: 'list',
        listType,
        items: listItems.map(format)
      });
      inList = false;
      listType = null;
      listItems = [];
      continue;
    }

    if (inList && trimmed.startsWith('\\item')) {
      listItems.push(trimmed.replace(/^\\item\s*/, ''));
      continue;
    }

    // --- Python block ---
    if (trimmed === '\\python') {
      flushCurrentBlock();
      currentField = 'python';
      currentQuestion = { type: 'python', lines: [] };
      continue;
    }

    if (trimmed === '\\endpython') {
      blocks.push({
        type: 'python',
        content: currentQuestion.lines.join('\n')
      });
      currentQuestion = null;
      currentField = 'prompt';
      continue;
    }

    if (currentField === 'python' && currentQuestion?.type === 'python') {
      currentQuestion.lines.push(line);
      continue;
    }

    // --- Headers ---
    const headerMatch = trimmed.match(/^\\(title|name|section)\{(.+?)\}$/);
    if (headerMatch) {
      flushCurrentBlock();
      blocks.push({
        type: 'header',
        tag: headerMatch[1],
        content: headerMatch[2]
      });
      continue;
    }

    // --- Group start ---
    if (trimmed.startsWith('\\questiongroup')) {
      if (currentGroupIntro) blocks.push(currentGroupIntro);
      flushCurrentBlock();
      groupNumber++;
      questionLetterCode = 97;
      currentGroupIntro = {
        type: 'groupIntro',
        groupId: groupNumber,
        content: ''
      };
      continue;
    }

    // --- Question start/end ---
    if (trimmed === '\\question') {
      if (currentGroupIntro) {
        blocks.push(currentGroupIntro);
        currentGroupIntro = null;
      }
      const id = String.fromCharCode(questionLetterCode++);
      currentQuestion = {
        type: 'question',
        id,
        label: `${id}.`,
        responseId: responseId++,
        prompt: '',
        responseLines: 1,
        samples: [],
        feedback: [],
        followups: []
      };
      currentField = 'prompt';
      continue;
    }

    if (trimmed === '\\endquestion') {
      blocks.push(currentQuestion);
      currentQuestion = null;
      currentField = 'prompt';
      continue;
    }

    // --- Question internals ---
    if (trimmed.startsWith('\\textresponse')) {
      const match = trimmed.match(/\\textresponse\{(\d+)\}/);
      if (match) currentQuestion.responseLines = parseInt(match[1]);
      continue;
    }

    if (trimmed === '\\sampleresponses') {
      currentField = 'samples';
      continue;
    }
    if (trimmed === '\\endsampleresponses') {
      currentField = 'prompt';
      continue;
    }

    if (trimmed === '\\feedbackprompt') {
      currentField = 'feedback';
      continue;
    }
    if (trimmed === '\\endfeedbackprompt') {
      currentField = 'prompt';
      continue;
    }

    if (trimmed === '\\followupprompt') {
      currentField = 'followups';
      continue;
    }
    if (trimmed === '\\endfollowupprompt') {
      currentField = 'prompt';
      continue;
    }

    // --- Treat \text{...} and similar as own block ---
    if (/^\\text(it|bf)?\{.+\}$/.test(trimmed)) {
      blocks.push({
        type: 'text',
        content: format(trimmed)
      });
      continue;
    }

    // --- Add to group intro or question ---
    if (currentGroupIntro && !currentQuestion) {
      currentGroupIntro.content += (currentGroupIntro.content ? ' ' : '') + format(line);
      continue;
    }

    if (currentQuestion) {
      if (currentField === 'prompt') {
        currentQuestion.prompt += (currentQuestion.prompt ? ' ' : '') + format(line);
      } else {
        currentQuestion[currentField].push(format(line));
      }
      continue;
    }

    // --- Fallback: generic text block ---
    currentBlock.push(format(line));
  }

  flushCurrentBlock();

  return blocks;
}


export function renderBlocks(blocks, options = {}) {
  const {
    editable = false,
    isActive = false,
    onSave = () => {},
    onSubmit = () => {},
  } = options;

  return blocks.map((block, index) => {
    if (block.type === 'python') {
      return (
        <ActivityPythonBlock
          key={index}
          code={block.content}
          blockIndex={index}
          editable={editable}
          isActive={isActive}
          onSave={onSave}
          onSubmit={onSubmit}
        />
      );
    }

    if (block.type === 'code') {
      return (
        <pre key={`code-${index}`} className="bg-light p-2 rounded">
          <code className="language-python">{block.content}</code>
        </pre>
      );
    }

    if (block.type === 'question') {
      return (
        <div key={`q-${block.id}`} className="mb-3">
          <p><strong>{block.label}</strong> {block.prompt}</p>
          {block.code?.map((codeBlock, i) => (
            <ActivityPythonBlock
              key={`qcode-${block.id}-${i}`}
              code={codeBlock.content}
              blockIndex={i}
            />
          ))}
          <ActivityQuestionBlock question={block} editable={editable} />
        </div>
      );
    }

    if (block.type === 'header') {
      return <ActivityHeader key={`h-${index}`} {...{ [block.tag]: block.content }} />;
    }

    if (block.type === 'groupIntro') {
      return (
        <div key={`g-${block.groupId}`} className="mb-3">
          <p><strong>{block.groupId}.</strong> {block.content}</p>
          {block.code?.map((codeBlock, i) => (
            <ActivityPythonBlock
              key={`gcode-${block.groupId}-${i}`}
              code={codeBlock.content}
              blockIndex={i}
            />
          ))}
        </div>
      );
    }

    if (block.type === 'text') {
      return (
        <p key={`text-${index}`} dangerouslySetInnerHTML={{ __html: block.content }} />
      );
    }

    if (block.type === 'list') {
      const ListTag = block.listType === 'ul' ? 'ul' : 'ol';
      return (
        <ListTag key={`list-${index}`} className="ms-4">
          {block.items.map((item, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: item }} />
          ))}
        </ListTag>
      );
    }

    return <div key={index}>[Unknown block type: {block.type}]</div>;
  });
}
