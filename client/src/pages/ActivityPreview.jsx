// ActivityPreview.jsx using Skulpt
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { API_BASE_URL } from '../config';
import { Container, Table, Form, Button } from 'react-bootstrap';
import Prism from 'prismjs';
import 'prismjs/themes/prism.css';
import 'prismjs/components/prism-python';

export default function ActivityPreview() {
  const { activityName } = useParams();
  const [activity, setActivity] = useState(null);
  const [sheetData, setSheetData] = useState([]);
  const [activeEditIndex, setActiveEditIndex] = useState(null);
  const [codeBlocks, setCodeBlocks] = useState([]);

useEffect(() => {
  const loadScript = (src) =>
    new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => {
        console.log(`✅ Loaded: ${src}`);
        resolve();
      };
      script.onerror = (e) => {
        console.error(`❌ Failed to load: ${src}`, e);
        reject(e);
      };
      document.body.appendChild(script);
    });

  const loadSkulpt = async () => {
    try {
      await loadScript('https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt.min.js'); // ✅ correct path
      await loadScript('https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt-stdlib.js'); // ✅ correct path
      console.log('✅ Skulpt fully loaded');
    } catch (err) {
      console.error('❌ Skulpt load error', err);
    }
  };

  loadSkulpt();
}, []);

useEffect(() => {
  const checkSkulptLoaded = setInterval(() => {
    if (window.Sk && window.Sk.configure) {
      console.log("✅ Skulpt loaded");
      clearInterval(checkSkulptLoaded);
    } else {
      console.log("⏳ Waiting for Skulpt...");
    }
  }, 500);

  return () => clearInterval(checkSkulptLoaded);
}, []);
    
 useEffect(() => {
    if (sheetData.length > 0) Prism.highlightAll();
  }, [sheetData]);

  useEffect(() => {
    Prism.highlightAll();
  }, [activeEditIndex]);

  useEffect(() => {
    const fetchActivityAndSheet = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/activities/${activityName}`);
        const activityData = await res.json();
        setActivity(activityData);

        const docRes = await fetch(`${API_BASE_URL}/activities/preview-doc?docUrl=${encodeURIComponent(activityData.sheet_url)}`);
        const { lines } = await docRes.json();
        setSheetData(lines);
      } catch (err) {
        console.error("Failed to fetch preview data", err);
      }
    };
    fetchActivityAndSheet();
  }, [activityName]);

  const formatText = (text) =>
    text.replace(/\\textit\{([^}]+)\}/g, '<em>$1</em>')
        .replace(/\\textbf\{([^}]+)\}/g, '<strong>$1</strong>');

  let elements = [],
      listStack = [],
      currentQuestion = null,
      pythonBlock = null,
      pythonBlockIndex = 0,
      collectedCodeBlocks = [];

  const finalizeQuestionBlock = () => {
    if (currentQuestion) {
      elements.push(
        <div key={currentQuestion.id} className="mb-4">
          <h5>Question: {currentQuestion.text}</h5>
          <Form.Control as="textarea" rows={currentQuestion.responseLines || 1} placeholder="Your response..." className="mb-2" />
          {currentQuestion.samples.length > 0 && <><h6>Sample Responses</h6><Table bordered size="sm"><tbody>{currentQuestion.samples.map((r, i) => <tr key={i}><td>{r}</td></tr>)}</tbody></Table></>}
          {currentQuestion.feedback.length > 0 && <><h6>Feedback Prompts</h6><Table bordered size="sm"><tbody>{currentQuestion.feedback.map((f, i) => <tr key={i}><td>{f}</td></tr>)}</tbody></Table></>}
          {currentQuestion.followups.length > 0 && <><h6>Followup Prompts</h6><Table bordered size="sm"><tbody>{currentQuestion.followups.map((f, i) => <tr key={i}><td>{f}</td></tr>)}</tbody></Table></>}
        </div>
      );
      currentQuestion = null;
    }
  };

  const pushListElement = (tag, content, index) => {
    if (listStack.length === 0 || listStack[listStack.length - 1].tag !== tag) listStack.push({ tag, items: [] });
    listStack[listStack.length - 1].items.push(<li key={`li-${index}`}>{formatText(content)}</li>);
  };

  const finalizeList = () => {
    while (listStack.length > 0) {
      const { tag, items } = listStack.pop();
      elements.push(tag === 'ul' ? <ul key={`ul-${elements.length}`}>{items}</ul> : <ol key={`ol-${elements.length}`}>{items}</ol>);
    }
  };

  sheetData.forEach((line, i) => {
    if (line.trim().startsWith('\\title{')) {
      finalizeQuestionBlock(); finalizeList();
      const title = line.match(/\\title\{(.+?)\}/)?.[1];
      elements.push(<h2 key={`title-${i}`}>{title}</h2>);
    } else if (line.trim().startsWith('\\name{')) {
      const name = line.match(/\\name\{(.+?)\}/)?.[1];
      elements.push(<h4 key={`name-${i}`}>Activity ID: {name}</h4>);
    } else if (line.trim().startsWith('\\section{')) {
      finalizeQuestionBlock(); finalizeList();
      const section = line.match(/\\section\{(.+?)\}/)?.[1];
      elements.push(<h3 key={`section-${i}`}>{section}</h3>);
    } else if (line === '\\roles') {
      finalizeQuestionBlock(); finalizeList();
      const roles = ['Spokesperson', 'Facilitator', 'Process Analyst', 'Quality Control'];
      elements.push(
        <div key="roles" className="mb-4">
          <h5>Assign Roles:</h5>
          {roles.map((role, idx) => (
            <div key={idx} className="mb-2">
              <strong>{role}:</strong>
              <Form.Control type="email" placeholder={`Email for ${role}`} className="mt-1" />
            </div>
          ))}
        </div>
      );
    } else if (line.startsWith('\\question{')) {
      finalizeQuestionBlock(); finalizeList();
      const id = line.match(/\\question\{(.+?)\}/)?.[1];
      currentQuestion = { id, text: '', responseLines: 1, samples: [], feedback: [], followups: [] };
    } else if (line.startsWith('\\textresponse')) {
      const match = line.match(/\\textresponse\{.+?,(\d+)\}/);
      if (currentQuestion) currentQuestion.responseLines = match ? parseInt(match[1]) : 1;
    } else if (["\\sampleresponses", "\\feedbackprompt", "\\followupprompt"].includes(line)) {
      // skip
    } else if (currentQuestion) {
      const prev = sheetData[i - 1];
      if (prev === '\\sampleresponses') currentQuestion.samples.push(formatText(line));
      else if (prev === '\\feedbackprompt') currentQuestion.feedback.push(formatText(line));
      else if (prev === '\\followupprompt') currentQuestion.followups.push(formatText(line));
      else if (currentQuestion.text === '') currentQuestion.text = formatText(line);
      else currentQuestion.text += ' ' + formatText(line);
    } else if (line === '\\begin{itemize}') {
      listStack.push({ tag: 'ul', items: [] });
    } else if (line === '\\end{itemize}') {
      finalizeList();
    } else if (line === '\\begin{enumerate}') {
      listStack.push({ tag: 'ol', items: [] });
    } else if (line === '\\end{enumerate}') {
      finalizeList();
    } else if (line.startsWith('\\item')) {
      pushListElement(listStack[listStack.length - 1]?.tag, line.replace(/^\\item\s*/, '').trim(), i);
    } else if (line.trim() === '\\python') {
      pythonBlock = [];
    } else if (line.trim() === '\\endpython') {
      const code = pythonBlock.join("\n");
      collectedCodeBlocks.push({ code, index: pythonBlockIndex });
      pythonBlock = null;
      pythonBlockIndex++;
    } else if (pythonBlock !== null) {
      pythonBlock.push(line);
    } else {
      elements.push(<p key={`p-${i}`} dangerouslySetInnerHTML={{ __html: formatText(line) }} />);
    }
  });

  finalizeQuestionBlock();
  finalizeList();

  return (
    <Container>
      <h2>Preview: {activity?.title}</h2>
      {elements}
      {collectedCodeBlocks.map(({ code, index }) => {
        const isEditing = activeEditIndex === index;
        const outputId = `sk-output-${index}`;
        return (
          <div key={`sk-${index}`} className="mb-3">
            <Button variant="secondary" className="mb-2" onClick={() => setActiveEditIndex(isEditing ? null : index)}>
              {isEditing ? "Done Editing" : "Edit Code"}
            </Button>
            {isEditing ? (
              <Form.Control
                as="textarea"
                rows={Math.max(6, code.split("\n").length)}
                defaultValue={code}
                className="mb-2 font-monospace bg-dark text-white"
                id={`sk-code-${index}`}
              />
            ) : (
              <pre className="m-0">
                <code className="language-python">{code}</code>
              </pre>
            )}
            <Button
              variant="primary"
              onClick={() => {
                const userCode = document.getElementById(`sk-code-${index}`)?.value;
                const outputEl = document.getElementById(outputId);
                if (!userCode || !outputEl) return;


if (!window.Sk || !window.Sk.configure) {
  alert("Skulpt is still loading...");
  return;
}

                outputEl.textContent = '';

                Sk.configure({
                  output: (text) => (outputEl.textContent += text),
                  read: (file) => {
                    if (
                      Sk.builtinFiles === undefined ||
                      Sk.builtinFiles["files"][file] === undefined
                    ) {
                      throw `File not found: '${file}'`;
                    }
                    return Sk.builtinFiles["files"][file];
                  },
                });

                Sk.misceval
                  .asyncToPromise(() => Sk.importMainWithBody("__main__", false, userCode, true))
                  .catch((err) => {
                    outputEl.textContent = err.toString();
                  });
              }}
            >
              Run Python
            </Button>
            <pre id={outputId} className="mt-2 bg-light p-2 border" />
          </div>
        );
      })}
    </Container>
  );
}
