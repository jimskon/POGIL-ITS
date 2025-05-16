// utils/parseSheet.js
import ActivityQuestionBlock from '../components/activity/ActivityQuestionBlock';
import ActivityHeader from '../components/activity/ActivityHeader';
import ActivityEnvironment from '../components/activity/ActivityEnvironment';
import ActivityPythonBlock from '../components/activity/ActivityPythonBlock';
import { Form } from 'react-bootstrap';

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
// --- Python block ---
if (trimmed === '\\python') {
  flushCurrentBlock();
  currentField = 'python';
  if (currentQuestion && currentQuestion.type === 'question') {
    if (!currentQuestion.pythonBlocks) currentQuestion.pythonBlocks = [];
    currentQuestion.pythonBlocks.push([]);
  } else {
    currentQuestion = { type: 'python', lines: [] };
  }
  continue;
}

if (trimmed === '\\endpython') {
  if (currentField === 'python') {
    if (currentQuestion?.type === 'python') {
      blocks.push({
        type: 'python',
        content: currentQuestion.lines.join('\n')
      });
      currentQuestion = null;
    } else if (currentQuestion?.pythonBlocks?.length > 0) {
      const lines = currentQuestion.pythonBlocks.pop();
      currentQuestion.pythonBlocks.push({
        type: 'python',
        content: lines.join('\n')
      });
    }
    currentField = 'prompt';
  }
  continue;
}

if (currentField === 'python') {
  if (currentQuestion?.type === 'python') {
    currentQuestion.lines.push(line);
  } else if (currentQuestion?.pythonBlocks?.length > 0) {
    currentQuestion.pythonBlocks[currentQuestion.pythonBlocks.length - 1].push(line);
  }
  continue;
}

    
    // --- Headers ---
    const headerMatch = trimmed.match(/^\\(title|name|section)\{(.+?)\}$/);
    if (headerMatch) {
      flushCurrentBlock();
      blocks.push({
        type: 'header',
        tag: headerMatch[1],
        content: format(headerMatch[2])
      });
      continue;
    }

    // --- Group start ---
    if (trimmed.startsWith('\\questiongroup{')) {
      flushCurrentBlock();
      groupNumber++;
      questionLetterCode = 97;
      const content = trimmed.match(/\\questiongroup\{(.+?)\}/)?.[1] || '';
      blocks.push({
        type: 'groupIntro',
        groupId: groupNumber,
        content: format(content)
      });
      continue;
    }

    if (trimmed === '\\endquestiongroup') {
      blocks.push({ type: 'endGroup' });
      continue;
    }

    // --- Question ---
    if (trimmed.startsWith('\\question{')) {
      const content = trimmed.match(/\\question\{(.+?)\}/)?.[1] || '';
      const id = String.fromCharCode(questionLetterCode++);
      currentQuestion = {
        type: 'question',
        id,
        groupId: groupNumber,              // ✅ Add group number to use in ID
        label: `${id}.`,
        responseId: responseId++,
        prompt: format(content),
        responseLines: 1,
        samples: [],
        feedback: [],
        followups: []
      };
      continue;
    }
    

    if (trimmed === '\\endquestion') {
      if (currentQuestion !== null) {
        blocks.push(currentQuestion);
      } else {
        console.warn("⚠️ \\endquestion found without matching \\question");
      }
      currentQuestion = null;
      continue;
    }

    if (trimmed.startsWith('\\textresponse')) {
      const match = trimmed.match(/\\textresponse\{(\d+)\}/);
      if (!currentQuestion) {
        console.warn("⚠️ \\textresponse found outside of a question block");
        continue;
      }
      if (match) currentQuestion.responseLines = parseInt(match[1]);
      continue;
    }

    if (trimmed.startsWith('\\sampleresponses{')) {
      const match = trimmed.match(/\\sampleresponses\{(.+?)\}/);
      if (match && currentQuestion) currentQuestion.samples.push(format(match[1]));
      continue;
    }

    if (trimmed.startsWith('\\feedbackprompt{')) {
      const match = trimmed.match(/\\feedbackprompt\{(.+?)\}/);
      if (match && currentQuestion) currentQuestion.feedback.push(format(match[1]));
      continue;
    }

    if (trimmed.startsWith('\\followupprompt{')) {
      const match = trimmed.match(/\\followupprompt\{(.+?)\}/);
      if (match && currentQuestion) currentQuestion.followups.push(format(match[1]));
      continue;
    }

    // --- \\textbf as line ---
    const textbfMatch = trimmed.match(/^\\textbf\{(.+?)\}$/);
    if (textbfMatch) {
      flushCurrentBlock();
      blocks.push({
        type: 'text',
        content: `<strong>${textbfMatch[1]}</strong>`
      });
      continue;
    }

    // --- Text fallback ---
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
    mode = 'preview',
    prefill = {} // ✅ New option for saved answers
  } = options;

  const hiddenTypesInRun = ['sampleresponses', 'feedbackprompt', 'followupprompt'];

  return blocks.map((block, index) => {
    if (hiddenTypesInRun.includes(block.type) && mode !== 'preview') {
      return null;
    }

    if (block.type === 'question') {
      const groupPrefix = block.groupId || ''; // ensure consistent ID format
      const questionKey = `${groupPrefix}${block.id}`;
      const saved = prefill[questionKey]?.response || '';

      return (
        <div key={`q-${block.id}`} className="mb-3">
          <p><strong>{block.label}</strong> {block.prompt}</p>

          {/* Text input with saved response */}
          <Form.Control
            as="textarea"
            rows={block.responseLines || 1}
            defaultValue={options.prefill?.[block.groupId + block.id] || ''}
            data-question-id={block.id}
            readOnly={!options.editable}
/>
        </div>
      );
    }

    if (block.type === 'python') {
      const saved = prefill[block.id]?.response || '';
      return (
        <ActivityPythonBlock
          key={index}
          code={saved || block.content}
          blockIndex={index}
          editable={editable}
          isActive={isActive}
          onSave={onSave}
          onSubmit={onSubmit}
        />
      );
    }

    // Other types (headers, lists, text, etc.)
    if (block.type === 'header') {
      return <ActivityHeader key={`h-${index}`} {...{ [block.tag]: block.content }} />;
    }

    if (block.type === 'groupIntro') {
      return <p key={`g-${block.groupId}`}><strong>{block.groupId}.</strong> {block.content}</p>;
    }

    if (block.type === 'text') {
      return <p key={`text-${index}`} dangerouslySetInnerHTML={{ __html: block.content }} />;
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

    if (block.type === 'endGroup') {
      return mode === 'preview'
        ? <hr key={`endgroup-${index}`} className="my-4" />
        : <div key={`endgroup-${index}`} data-type="endGroup" />;
    }

    return <div key={index}>[Unknown block type: {block.type}]</div>;
  });
}
