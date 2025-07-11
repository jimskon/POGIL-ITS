// parseSheet.jsx

import ActivityQuestionBlock from '../components/activity/ActivityQuestionBlock';
import ActivityHeader from '../components/activity/ActivityHeader';
import ActivityEnvironment from '../components/activity/ActivityEnvironment';
import ActivityPythonBlock from '../components/activity/ActivityPythonBlock';
import { Form } from 'react-bootstrap';

import { useState, useEffect } from 'react';

export default function FileBlock({ filename, fileContents, editable, setFileContents }) {
  // ✅ Local editing buffer
  const [localValue, setLocalValue] = useState(fileContents?.[filename] || '');

  // ✅ Sync local when fileContents changes from outside (initial load or external update)
  useEffect(() => {
    setLocalValue(fileContents?.[filename] || '');
  }, [fileContents, filename]);

  const handleChange = (e) => {
    const updated = e.target.value;
    setLocalValue(updated);

    if (editable && setFileContents) {
      setFileContents(prev => ({
        ...prev,
        [filename]: updated,
      }));
    }
  };

  return (
    <div className="mb-3">
      <strong>📄 File: <code>{filename}</code></strong>
      <Form.Control
        as="textarea"
        value={localValue}
        onChange={handleChange}
        rows={Math.max(4, localValue.split('\n').length)}
        readOnly={!editable}
        className="font-monospace bg-light mt-1"
      />
    </div>
  );
}




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
  let inFileBlock = false;
  let currentFile = null;

  const flushCurrentBlock = () => {
    if (currentBlock.length > 0) {
      blocks.push({
        type: 'text',
        content: format(currentBlock.join(' ').trim())
      });
      currentBlock = [];
    }
  };

  const format = (text) =>
    text.replace(/\\textbf\{(.+?)\}/g, '<strong>$1</strong>')
      .replace(/\\textit\{(.+?)\}/g, '<em>$1</em>')
      .replace(/\\text\{(.+?)\}/g, '$1')
      .replace(/\\\\/g, '<br>');

  for (let line of lines) {
    const trimmed = line.trim();

    const linkMatch = trimmed.match(/^\\link\{(.+?)\}\{(.+?)\}$/);
    if (linkMatch) {
      flushCurrentBlock();
      const url = linkMatch[1].trim();
      const label = linkMatch[2].trim();
      blocks.push({ type: 'link', url, label });
      continue;
    }

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

    const pythonMatch = trimmed.match(/^\\python(?:\{(\d+)\})?$/);
    if (pythonMatch) {
      flushCurrentBlock();
      currentField = 'python';
      const timeLimit = pythonMatch[1] ? parseInt(pythonMatch[1]) : 50000;

      const blockObj = { type: 'python', lines: [], timeLimit };

      if (currentQuestion && currentQuestion.type === 'question') {
        if (!currentQuestion.pythonBlocks) currentQuestion.pythonBlocks = [];
        currentQuestion.pythonBlocks.push(blockObj);
      } else {
        blocks.push(blockObj);
      }

      continue;
    }


    if (trimmed === '\\endpython') {
      if (currentField === 'python') {
        const lastBlock = blocks.at(-1);
        if (lastBlock?.type === 'python' && lastBlock.lines) {
          lastBlock.content = lastBlock.lines.join('\n');
          delete lastBlock.lines;
        } else if (currentQuestion?.pythonBlocks?.length > 0) {
          const block = currentQuestion.pythonBlocks.pop();
          currentQuestion.pythonBlocks.push({
            type: 'python',
            content: block.lines.join('\n'),
            timeLimit: block.timeLimit || 50000
          });

        }
        currentField = 'prompt';
      }
      continue;
    }

    if (currentField === 'python') {
      const lastBlock = blocks.at(-1);
      if (lastBlock?.type === 'python' && lastBlock.lines) {
        lastBlock.lines.push(line);
      } else if (currentQuestion?.pythonBlocks?.length > 0) {
        const lastQuestionBlock = currentQuestion.pythonBlocks.at(-1);
        lastQuestionBlock.lines.push(line);
      }
      continue;
    }

    const headerMatch = trimmed.match(/^\\(title|name)\{(.+?)\}$/);
    if (headerMatch) {
      flushCurrentBlock();
      blocks.push({ type: 'header', tag: headerMatch[1], content: format(headerMatch[2]) });
      continue;
    }

    const sectionMatch = trimmed.match(/^\\section\*?\{(.+?)\}$/);
    if (sectionMatch) {
      flushCurrentBlock();
      blocks.push({ type: 'section', title: format(sectionMatch[1]) });
      continue;
    }

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
        samples: [],
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
      if (match && currentQuestion) {
        currentQuestion.responseLines = parseInt(match[1]);
        currentQuestion.hasTextResponse = true;
      }
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

    const textbfMatch = trimmed.match(/^\\textbf\{(.+?)\}$/);
    if (textbfMatch) {
      flushCurrentBlock();
      blocks.push({ type: 'text', content: `<strong>${textbfMatch[1]}</strong>` });
      continue;
    }

    // --- Handle tables ---
    if (trimmed.startsWith('\\table{')) {
      flushCurrentBlock();
      const title = trimmed.match(/\\table\{(.+?)\}/)?.[1] || '';
      const newTable = {
        type: 'table',
        title: format(title),
        rows: [],
      };

      if (currentQuestion?.type === 'question') {
        if (!currentQuestion.tableBlocks) currentQuestion.tableBlocks = [];
        currentQuestion.tableBlocks.push(newTable);
      } else {
        currentQuestion = newTable; // standalone table
      }
      continue;
    }

    if (trimmed === '\\endtable') {
      if (currentQuestion?.type === 'table') {
        blocks.push(currentQuestion);
        currentQuestion = null;
      }
      continue;
    }

    if (trimmed.startsWith('\\row')) {
      const target = currentQuestion?.type === 'question'
        ? currentQuestion.tableBlocks?.at(-1)
        : currentQuestion;

      if (target?.type === 'table') {
        const rawCells = trimmed.replace(/^\\row\s*/, '').split('&');
        const cells = rawCells.map(cell => {
          const trimmedCell = cell.trim();
          const isInput = trimmedCell === '\\tresponse';

          if (isInput && currentQuestion?.type === 'question') {
            currentQuestion.hasTableResponse = true;
          }

          return isInput
            ? { type: 'input' }
            : { type: 'static', content: format(trimmedCell) };
        });

        target.rows.push(cells);
      }
      continue;
    }

    if (trimmed.startsWith('\\file{')) {
      flushCurrentBlock();
      inFileBlock = true;
      const filename = trimmed.match(/\\file\{(.+?)\}/)?.[1]?.trim();
      console.log("📂 Starting file block for:", filename);
      currentFile = { type: 'file', filename, lines: [] };
      continue;
    }

    if (trimmed === '\\endfile') {
      if (currentFile) {
        blocks.push({
          ...currentFile,
          content: currentFile.lines.join('\n'),
        });
        currentFile = null;
      }
      inFileBlock = false;
      continue;
    }

    if (inFileBlock && currentFile) {
      currentFile.lines.push(line);
      continue;
    }

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
    onCodeChange = null,
    codeFeedbackShown = {},
    fileContents,
    setFileContents,
  } = options;

  let standaloneCodeCounter = 1;
  const hiddenTypes = ['sampleresponses', 'feedbackprompt', 'followupprompt'];

  return blocks.map((block, index) => {
    if (hiddenTypes.includes(block.type) && mode !== 'preview') return null;
    if (block.type === 'endGroup') return null;

    if (block.type === 'section') {
      return (
        <h2 key={`section-${index}`} className="my-3">
          {block.title}
        </h2>
      );
    }

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

    if (block.type === 'link') {
      return (
        <p key={`link-${index}`}>
          <a href={block.url} target="_blank" rel="noopener noreferrer">
            {block.label}
          </a>
        </p>
      );
    }


    if (block.type === 'groupIntro') {
      return (
        <div key={`groupIntro-${index}`} className="mb-2">
          <strong>{block.groupId}. <span dangerouslySetInnerHTML={{ __html: block.content }} /></strong>
        </div>

      );
    }

    if (block.type === 'file') {
      return (
        <FileBlock
          key={`file-${block.filename}`} // ✅ stable and unique
          filename={block.filename}
          fileContents={fileContents}
          setFileContents={setFileContents}
          editable={true}
        />

      );
    }



    if (block.type === 'python') {
      const groupPrefix = (currentGroupIndex + 1).toString(); // dynamic group number
      const codeKey = `${groupPrefix}code${standaloneCodeCounter++}`;

      return (
        <ActivityPythonBlock
          key={`py-${index}-${block.content?.slice(0, 10) || ''}`}

          code={
            prefill?.[codeKey]?.response
            || block.content
            || ''
          }
          blockIndex={`py-${codeKey}-${index}`}
          editable={editable && isActive}
          responseKey={codeKey}
          onCodeChange={onCodeChange}
          codeFeedbackShown={codeFeedbackShown}
          fileContents={fileContents}
          setFileContents={setFileContents}
          timeLimit={block.timeLimit || 50000}
        />

      );
    }
    if (block.type === 'table') {
      return (
        <div key={`table-${index}`} className="my-4">
          <h4 className="mb-2">{block.title}</h4>
          <table className="table table-bordered">
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={`table-${index}-row-${i}`}>
                  {row.map((cell, j) => {
                    const cellKey = `table${index}cell${i}_${j}`;
                    if (cell.type === 'input') {
                      return (
                        <td key={cellKey}>
                          <Form.Control
                            type="text"
                            value={prefill?.[cellKey]?.response || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (options.onTextChange) {
                                options.onTextChange(cellKey, val);
                              }
                            }}
                            readOnly={!editable}
                            data-question-id={cellKey}
                          />
                        </td>
                      );
                    } else {
                      return (
                        <td
                          key={cellKey}
                          dangerouslySetInnerHTML={{ __html: cell.content }}
                        />
                      );
                    }
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }




    if (block.type === 'question') {
      const responseKey = `${block.groupId}${block.id}`;
      const followupAppeared = !!followupsShown?.[responseKey];
      const groupComplete = prefill?.[`${responseKey}S`] === 'complete';


      return (
        <div key={`q-${block.groupId}-${block.id}`}  // ✅ unique per question
          className="mb-4">
          <p>
            <strong>{block.label}</strong>{' '}
            <span dangerouslySetInnerHTML={{ __html: block.prompt }} />
            {followupAppeared && (
              <span
                className="ms-2"
                title="Response locked due to follow-up"
                style={{ color: '#888', cursor: 'not-allowed' }}
              >
                🔒
              </span>
            )}
          </p>

          {block.pythonBlocks?.map((py, i) => {
            const responseKey = `${block.groupId}${block.id}code${i + 1}`;
            const savedResponse = prefill?.[responseKey]?.response || py.content;
            return (
              <ActivityPythonBlock
                key={`q-${block.groupId}-${block.id}-py-${i}`} // ✅ stable per question/code block

                code={savedResponse}
                blockIndex={`q-${currentGroupIndex}-${block.id}-${i}`}
                editable={editable && isActive}
                responseKey={responseKey}
                onCodeChange={onCodeChange}
                codeFeedbackShown={codeFeedbackShown}
                fileContents={fileContents}
                setFileContents={setFileContents}
              />

            );
          })}
          {block.tableBlocks?.map((table, i) => (
            <div key={`q-table-${index}-${i}`} className="my-3">
              <h5>{table.title}</h5>
              <table className="table table-bordered">
                <tbody>
                  {table.rows.map((row, ri) => (
                    <tr key={`row-${ri}`}>
                      {row.map((cell, ci) => {
                        const cellKey = `${block.groupId}${block.id}table${i}cell${ri}_${ci}`;
                        if (cell.type === 'input') {
                          return (
                            <td key={cellKey}>
                              <Form.Control
                                type="text"
                                value={prefill?.[cellKey]?.response || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (options.onTextChange) {
                                    options.onTextChange(cellKey, val);
                                  }
                                }}
                                readOnly={!editable}
                                data-question-id={cellKey}
                              />
                            </td>
                          );
                        } else {
                          return (
                            <td
                              key={cellKey}
                              dangerouslySetInnerHTML={{ __html: cell.content }}
                            />
                          );
                        }
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}



          {block.hasTextResponse || !block.hasTableResponse ? (
            <Form.Control
              as="textarea"
              rows={Math.max((block.responseLines || 1), 2)}
              value={prefill?.[responseKey]?.response || ''}
              readOnly={!editable || (prefill?.[`${block.groupId}state`]?.response === 'complete')}
              data-question-id={responseKey}
              className="mt-2"
              style={{ resize: 'vertical' }}
              onChange={(e) => {
                const val = e.target.value;
                if (options.onTextChange) {
                  options.onTextChange(responseKey, val);
                }
              }}
            />

          ) : null}

          {mode === 'preview' && (
            <>
              {block.samples?.length > 0 && <p className="text-muted"><em>Sample: {block.samples.join('; ')}</em></p>}
              {block.feedback?.length > 0 && <p className="text-muted"><em>Feedback: {block.feedback.join('; ')}</em></p>}
              {block.followups?.length > 0 && <p className="text-muted"><em>Follow-up: {block.followups.join('; ')}</em></p>}
            </>
          )}

          {/* Show saved followup Q&A in read-only format */}


          {/* Follow-up input or locked view */}
          {/* Follow-up input or locked view */}
          {followupsShown?.[responseKey] && (() => {
            const followupKey = `${responseKey}FA1`;
            return (
              <>
                <div className="mt-3 text-muted">
                  <strong>Follow-up:</strong> {followupsShown[responseKey]}
                  {(prefill?.[followupKey] || !editable) && (
                    <span
                      className="ms-2"
                      title="Follow-up response is locked"
                      style={{ color: '#888', cursor: 'not-allowed' }}
                    >
                      🔒
                    </span>
                  )}
                </div>

                {!editable ||
                  prefill?.[followupKey] ||
                  Object.keys(followupsShown)
                    .filter((k) => k !== responseKey)
                    .some((k) => {
                      const [kGroup, kLetter] = k.match(/^(\d+)([a-z])/).slice(1);
                      const [rGroup, rLetter] = responseKey.match(/^(\d+)([a-z])/).slice(1);
                      return parseInt(kGroup) > parseInt(rGroup) ||
                        (parseInt(kGroup) === parseInt(rGroup) && kLetter > rLetter);
                    })
                  ? (
                    <div className="bg-light p-2 rounded mt-1">
                      {prefill?.[followupKey]?.response || followupAnswers?.[followupKey] || ''}

                    </div>
                  ) : (
                    <Form.Control
                      as="textarea"
                      rows={2}
                      value={followupAnswers?.[followupKey] || ''}
                      placeholder="Respond to the follow-up question here..."
                      onChange={(e) => {
                        const val = e.target.value;

                        setFollowupAnswers(prev => ({
                          ...prev,
                          [followupKey]: val
                        }));

                        if (options.isActive && options.socket) {
                          console.log("📡 EMITTING FOLLOW-UP RESPONSE", {
                            instanceId: options.instanceId,
                            responseKey: followupKey,
                            value: val,
                            answeredBy: options.answeredBy
                          });

                          options.socket.emit('response:update', {
                            instanceId: options.instanceId,
                            responseKey: followupKey,
                            value: val,
                            answeredBy: options.answeredBy,
                            followupPrompt: options.followupsShown?.[responseKey]
                          });
                        }
                      }}
                      className="mt-1"
                      style={{ resize: 'vertical' }}
                    />
                  )}
              </>
            );
          })()}


        </div>
      );
    }

    return null;
  });
}


// End parseSheet.jsx
