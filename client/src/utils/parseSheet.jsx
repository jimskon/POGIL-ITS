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
      .replace(/\\textit\{(.+?)\}/g, '<em>$1</em>');

  for (let line of lines) {
    const trimmed = line.trim();
    console.log("Processing line:", trimmed);

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

    if (trimmed.startsWith('\\questiongroup')) {
      if (currentGroupIntro) {
        blocks.push(currentGroupIntro);
      }
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

    if (trimmed === '\\python') {
      flushCurrentBlock();
      currentField = 'python';
      currentQuestion = { type: 'code', language: 'python', lines: [] };
      continue;
    }
    if (trimmed === '\\endpython') {
      blocks.push({
        type: 'code',
        language: 'python',
        content: currentQuestion.lines.join('\n')
      });
      currentQuestion = null;
      currentField = 'prompt';
      continue;
    }
    if (currentField === 'python' && currentQuestion?.type === 'code') {
      currentQuestion.lines.push(line);
      continue;
    }

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
    } else {
      currentBlock.push(format(line));
    }
  }

  if (currentBlock.length > 0) {
    flushCurrentBlock();
  }

  return blocks;
}

export function renderBlocks(blocks) {
  return blocks.map((block, index) => {
    if (block.type === 'text') {
      return <p key={`t-${index}`} dangerouslySetInnerHTML={{ __html: block.content }} />;
    }
    if (block.type === 'code') {
      return (
        <pre className="bg-light p-3 rounded" key={`c-${index}`}>
          <code>{block.content}</code>
        </pre>
      );
    }
    if (block.type === 'question') {
      return (
        <div key={`q-${block.id}`} className="mb-3">
          <p><strong>{block.label}</strong> {block.prompt}</p>
          <ActivityQuestionBlock key={block.id} question={block} editable={false} />
        </div>
      );
    }
    if (block.type === 'header') {
      return <ActivityHeader key={`h-${index}`} {...{ [block.tag]: block.content }} />;
    }
    if (block.type === 'groupIntro') {
      return (
        <p key={`g-${block.groupId}`}><strong>{block.groupId}.</strong> {block.content}</p>
      );
    }
    return null;
  });
}
