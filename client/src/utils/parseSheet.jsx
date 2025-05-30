// parseSheet.jsx

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
    text.replace(/\\textbf\{(.+?)\}/g, '<strong>$1</strong>')
      .replace(/\\textit\{(.+?)\}/g, '<em>$1</em>')
      .replace(/\\text\{(.+?)\}/g, '$1');

  for (let line of lines) {
    const trimmed = line.trim();
    //console.log("Processing line:", trimmed);

    // --- Handle lists ---
    if (trimmed === '\\begin{itemize}' || trimmed === '\\begin{enumerate}') {
      inList = true;
      listType = trimmed.includes('itemize') ? 'ul' : 'ol';
      listItems = [];
      continue;
    }

    if (trimmed === '\\end{itemize}' || trimmed === '\\end{enumerate}') {
      blocks.push({ type: 'list', listType, items: listItems.map(format) });
      inList = false;
      listType = null;
      listItems = [];
      continue;
    }

    if (inList && trimmed.startsWith('\\item')) {
      listItems.push(trimmed.replace(/^\\item\s*/, ''));
      continue;
    }

    // --- Handle Python blocks ---
    if (trimmed === '\\python') {
      flushCurrentBlock();
      currentField = 'python';
      if (currentQuestion && currentQuestion.type === 'question') {
        if (!currentQuestion.pythonBlocks) currentQuestion.pythonBlocks = [];
        currentQuestion.pythonBlocks.push({ lines: [] });
      } else {
        currentQuestion = { type: 'python', lines: [] };
      }
      continue;
    }

    if (trimmed === '\\endpython') {
      if (currentField === 'python') {
        if (currentQuestion?.type === 'python') {
          blocks.push({ type: 'python', content: currentQuestion.lines.join('\n') });
          currentQuestion = null;
        } else if (currentQuestion?.pythonBlocks?.length > 0) {
          const block = currentQuestion.pythonBlocks.pop();
          currentQuestion.pythonBlocks.push({
            type: 'python',
            content: block.lines.join('\n')
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
        const lastBlock = currentQuestion.pythonBlocks[currentQuestion.pythonBlocks.length - 1];
        lastBlock.lines.push(line);
      }
      continue;
    }

    // --- Handle headers and sections ---
    const headerMatch = trimmed.match(/^\\(title|name)\{(.+?)\}$/);
    if (headerMatch) {
      flushCurrentBlock();
      blocks.push({ type: 'header', tag: headerMatch[1], content: format(headerMatch[2]) });
      continue;
    }

    const sectionMatch = trimmed.match(/^\\section\*?\{(.+?)\}$/);
    if (sectionMatch) {
      flushCurrentBlock();
      blocks.push({ type: 'section', name: format(sectionMatch[1]), content: [] });
      continue;
    }

    // --- Handle question groups and questions ---
    if (trimmed.startsWith('\\questiongroup{')) {
      flushCurrentBlock();
      groupNumber++;
      questionLetterCode = 97;
      const content = trimmed.match(/\\questiongroup\{(.+?)\}/)?.[1] || '';
      blocks.push({ type: 'groupIntro', groupId: groupNumber, content: format(content) });
      continue;
    }

    if (trimmed === '\\endquestiongroup') {
      blocks.push({ type: 'endGroup' });
      continue;
    }

    if (trimmed.startsWith('\\question{')) {
      const content = trimmed.match(/\\question\{(.+?)\}/)?.[1] || '';
      const id = String.fromCharCode(questionLetterCode++);
      currentQuestion = {
        type: 'question',
        id,
        groupId: groupNumber,
        label: `${id}.`,
        responseId: responseId++,
        prompt: format(content),
        responseLines: 1,
        samples: [],     // ✅ AI Fields: parsed here
        feedback: [],
        followups: []
      };
      continue;
    }

    if (trimmed === '\\endquestion') {
      if (currentQuestion !== null) blocks.push(currentQuestion);
      currentQuestion = null;
      continue;
    }

    if (trimmed.startsWith('\\textresponse')) {
      const match = trimmed.match(/\\textresponse\{(\d+)\}/);
      if (match && currentQuestion) currentQuestion.responseLines = parseInt(match[1]);
      continue;
    }

    // ✅ AI Fields parsing
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

    // --- Simple bold lines ---
    const textbfMatch = trimmed.match(/^\\textbf\{(.+?)\}$/);
    if (textbfMatch) {
      flushCurrentBlock();
      blocks.push({ type: 'text', content: `<strong>${textbfMatch[1]}</strong>` });
      continue;
    }

    // --- Default text fallback ---
    currentBlock.push(format(line));
  }

  flushCurrentBlock();
  return blocks;
}

export function renderBlocks(blocks, options = {}) {
  const {
    editable = false,
    isActive = false,
    prefill = {},
    mode = 'preview',
    currentGroupIndex = null,
    followupsShown = {},
    followupAnswers = {},
    setFollowupAnswers = () => { },
    setCodeAnswers = () => {} 
  } = options;

  const hiddenTypes = ['sampleresponses', 'feedbackprompt', 'followupprompt'];

  return blocks.map((block, index) => {
    if (hiddenTypes.includes(block.type) && mode !== 'preview') return null;

    if (block.type === 'endGroup') return null;

    if (block.type === 'text') {
      return (
        <p key={`text-${index}`} className="my-2">
          <span dangerouslySetInnerHTML={{ __html: block.content }} />
        </p>
      );
    }

    if (block.type === 'list') {
      const ListTag = block.listType === 'ul' ? 'ul' : 'ol';
      return (
        <ListTag key={`list-${index}`} className="my-2 list-disc list-inside">
          {block.items.map((item, i) => (
            <li key={`list-item-${i}`}>{item}</li>
          ))}
        </ListTag>
      );
    }

    if (block.type === 'groupIntro') {
      return (
        <div key={`groupIntro-${index}`} className="mb-2">
          <strong>{block.content}</strong>
        </div>
      );
    }

    if (block.type === 'python') {
      return (
        <ActivityPythonBlock
          key={`py-${index}`}
          code={block.content}
          blockIndex={index}
          editable={editable && isActive}
        />
      );
    }

    if (block.type === 'question') {
      const responseKey = `${block.groupId}${block.id}`;
      const followupQs = Object.entries(prefill)
        .filter(([key]) => key.startsWith(responseKey + 'F') && !key.includes('FA'))
        .sort(([a], [b]) => a.localeCompare(b));
      return (
        <div key={`q-${block.id}`} className="mb-4">
          <p>
            <strong>{block.label}</strong>{' '}
            <span dangerouslySetInnerHTML={{ __html: block.prompt }} />
          </p>

          {block.pythonBlocks?.map((py, i) => (
            <ActivityPythonBlock
              key={`q-${block.id}-py-${i}`}
              code={prefill?.[`${block.groupId}${block.id}CODE${i + 1}`]?.response || py.content}
              editable={editable && isActive}
              questionId={`${block.groupId}${block.id}`}
              codeIndex={i}
              setCodeAnswers={setCodeAnswers}
            />
          ))}

          <Form.Control
            as="textarea"
            rows={Math.max((block.responseLines || 1), 2)}
            defaultValue={prefill?.[responseKey]?.response || ''}
            readOnly={!editable || prefill?.[responseKey + 'S']?.response === 'complete'}

            data-question-id={responseKey}
            className="mt-2"
            style={{ resize: 'vertical' }}
          />

          {mode === 'preview' && (
            <>
              {block.samples?.length > 0 && <p className="text-muted"><em>Sample: {block.samples.join('; ')}</em></p>}
              {block.feedback?.length > 0 && <p className="text-muted"><em>Feedback: {block.feedback.join('; ')}</em></p>}
              {block.followups?.length > 0 && <p className="text-muted"><em>Follow-up: {block.followups.join('; ')}</em></p>}
            </>
          )}

          {/* Show saved followup Q&A in read-only format */}
          {followupQs.map(([fqid], i) => {
            const fq = prefill[fqid]?.response;
            const faid = fqid.replace('F', 'FA');
            const fa = prefill[faid]?.response;
            return (
              <div key={fqid} className="mt-3">
                <div className="text-muted"><strong>Follow-up {i + 1}:</strong> {fq}</div>
                {fa && <div className="bg-light p-2 rounded mt-1">{fa}</div>}
              </div>
            );
          })}

          {/* Show live follow-up if we're mid-response */}
          {editable && followupsShown?.[responseKey] && !prefill?.[`${responseKey}FA1`] && (
            <>
              <div className="mt-3 text-muted">
                <strong>Follow-up:</strong> {followupsShown[responseKey]}
              </div>
              <Form.Control
                as="textarea"
                rows={2}
                value={followupAnswers?.[responseKey] || ''}
                placeholder="Respond to the follow-up question here..."
                onChange={(e) =>
                  setFollowupAnswers((prev) => ({
                    ...prev,
                    [responseKey]: e.target.value,
                  }))
                }
                className="mt-1"
                style={{ resize: 'vertical' }}
              />
            </>
          )}

        </div>
      );
    }

    return null;
  });
}

// End parseSheet.jsx
