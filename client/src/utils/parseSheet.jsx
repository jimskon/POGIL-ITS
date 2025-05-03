// utils/parseSheet.js
import ActivityQuestionBlock from '../components/activity/ActivityQuestionBlock';
import ActivityHeader from '../components/activity/ActivityHeader';
import ActivityEnvironment from '../components/activity/ActivityEnvironment';
import ActivityPythonBlock from '../components/activity/ActivityPythonBlock';

export function parseSheetToBlocks(lines) {
  console.log("🧠 parseSheetToBlocks invoked");
  const blocks = [];
  let groupNumber = 0;
  let questionLetterCode = 97;
  let responseId = 1;

  let currentQuestion = null;
  let currentField = 'prompt';
  let currentBlock = [];

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
    // Header blocks
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

    // Start/end question group
    if (trimmed.startsWith('\\questiongroup')) {
      flushCurrentBlock();
      groupNumber++;
      questionLetterCode = 97;
      continue;
    }

    if (trimmed === '\\question') {
      flushCurrentBlock();
      const id = `${groupNumber}${String.fromCharCode(questionLetterCode++)}`;
      currentQuestion = {
        type: 'question',
        id,
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

    // Python block
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

    // Add lines to the current question field
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
    if (block.type === 'code' && block.language === 'python') {
      return (
        <ActivityPythonBlock
          key={`py-${index}`}
          code={block.content}
          blockIndex={index}
        />
      );
    }
    if (block.type === 'question') {
      console.log("📦 Rendering question block:", block);
      return <ActivityQuestionBlock key={block.id} question={block} editable={false} />;
    }
    if (block.type === 'header') {
      return <ActivityHeader key={`h-${index}`} {...{ [block.tag]: block.content }} />;
    }
    if (block.type === 'list') {
      const Tag = block.listType;
      return (
        <Tag key={`list-${index}`}>
          {block.items.map((item, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: item }} />
          ))}
        </Tag>
      );
    }
    return null;
  });
}
