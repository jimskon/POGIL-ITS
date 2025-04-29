// FINAL corrected ActivityPreview.jsx
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { API_BASE_URL } from '../config';
import { Container, Table, Form, Button, Card } from 'react-bootstrap';
import Prism from 'prismjs';
import 'prismjs/themes/prism.css';
import 'prismjs/components/prism-python';

export default function ActivityPreview() {
  const { activityName } = useParams();
  const [activity, setActivity] = useState(null);
  const [sheetData, setSheetData] = useState([]);
  const [activeEditIndex, setActiveEditIndex] = useState(null);

  let environment = null;
  let environmentBuffer = [];
  let currentQuestion = null;
  let currentField = 'text';
  let collectingSamples = false;
  let collectingFeedback = false;
  let collectingFollowups = false;
  let pythonBlock = null;
  let pythonBlockIndex = 0;

  useEffect(() => {
    const loadScript = (src) => new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = reject;
      document.body.appendChild(script);
    });

    const loadSkulpt = async () => {
      try {
        await loadScript('https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt.min.js');
        await loadScript('https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt-stdlib.js');
      } catch (err) {
        console.error('Failed to load Skulpt', err);
      }
    };
    loadSkulpt();
  }, []);

  useEffect(() => {
    if (sheetData.length > 0) Prism.highlightAll();
  }, [sheetData]);

  useEffect(() => {
    const fetchActivityAndSheet = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/activities/${activityName}`);
        const activityData = await res.json();
        setActivity(activityData);

        const docRes = await fetch(`${API_BASE_URL}/api/activities/preview-doc?docUrl=${encodeURIComponent(activityData.sheet_url)}`);
        const { lines } = await docRes.json();
        setSheetData(lines);
      } catch (err) {
        console.error("Failed to fetch preview data", err);
      }
    };
    fetchActivityAndSheet();
  }, [activityName]);

  useEffect(() => {
    // Re-highlight whenever editing toggles                                                                
    Prism.highlightAll();
  }, [activeEditIndex]);


  const formatText = (text) =>
    text.replace(/\\textit\{([^}]+)\}/g, '<em>$1</em>')
        .replace(/\\textbf\{([^}]+)\}/g, '<strong>$1</strong>');

const createPythonBlock = (code, index) => {
  const isEditing = activeEditIndex === index;
  const outputId = `sk-output-${index}`;
  const codeId = `sk-code-${index}`;

  return (
    <div key={`sk-${index}`} className="mb-4">
      <Button
        variant="secondary"
        className="mb-2 me-2"
        onClick={() => setActiveEditIndex(isEditing ? null : index)}
      >
        {isEditing ? "Done Editing" : "Edit Code"}
      </Button>

      <Button
        variant="primary"
        className="mb-2"
        onClick={() => {
          const userCode = document.getElementById(codeId)?.value || code;
          const outputEl = document.getElementById(outputId);
          if (!outputEl) return;

          if (!window.Sk || !window.Sk.configure) {
            alert("Skulpt is still loading...");
            return;
          }

          outputEl.textContent = '';

          Sk.configure({
            output: (text) => (outputEl.textContent += text),
            read: (file) => {
              if (Sk.builtinFiles === undefined || Sk.builtinFiles["files"][file] === undefined) {
                throw `File not found: '${file}'`;
              }
              return Sk.builtinFiles["files"][file];
            },
          });

          Sk.misceval
            .asyncToPromise(() => Sk.importMainWithBody("__main__", false, userCode, true))
            .catch((err) => outputEl.textContent = err.toString());
        }}
      >
        Run Python
      </Button>

      {isEditing ? (
        <Form.Control
          as="textarea"
          id={codeId}
          defaultValue={code}
          rows={Math.max(6, code.split("\n").length)}
          className="font-monospace bg-dark text-white mt-2"
        />
      ) : (
        <pre className="mt-2">
          <code id={codeId} className="language-python">
            {code}
          </code>
        </pre>
      )}

      <pre id={outputId} className="mt-2 bg-light p-2 border" />
    </div>
  );
};

  let elements = [];
  let listStack = [];

  const finalizeQuestionBlock = () => {
    if (currentQuestion) {
      elements.push(
        <div key={currentQuestion.id} className="mb-4">
          <p dangerouslySetInnerHTML={{ __html: currentQuestion.text }} />
          <Form.Control as="textarea" rows={currentQuestion.responseLines || 1} placeholder="Your response..." className="mb-2" />
          {currentQuestion.samples.length > 0 && <><h6>Sample Responses</h6><Table bordered size="sm"><tbody>{currentQuestion.samples.map((r, i) => <tr key={i}><td>{r}</td></tr>)}</tbody></Table></>}
          {currentQuestion.feedback.length > 0 && <><h6>Feedback Prompts</h6><Table bordered size="sm"><tbody>{currentQuestion.feedback.map((f, i) => <tr key={i}><td>{f}</td></tr>)}</tbody></Table></>}
          {currentQuestion.followups.length > 0 && <><h6>Followup Prompts</h6><Table bordered size="sm"><tbody>{currentQuestion.followups.map((f, i) => <tr key={i}><td>{f}</td></tr>)}</tbody></Table></>}
        </div>
      );
      currentQuestion = null;
    }
  };

const finalizeEnvironment = () => {
  if (environment) {
    const envElements = [];
    let envListStack = [];

    environmentBuffer.forEach((line, idx) => {
const trimmed = line.trim();
if (trimmed === '\\begin{itemize}') {
  envListStack.push({ tag: 'ul', items: [] });
} else if (trimmed === '\\begin{enumerate}') {
  envListStack.push({ tag: 'ol', items: [] });
} else if (trimmed === '\\end{itemize}' || trimmed === '\\end{enumerate}') {
  const { tag, items } = envListStack.pop();
  if (items.length > 0) {
    envElements.push(tag === 'ul'
      ? <ul key={`env-ul-${idx}`}>{items}</ul>
      : <ol key={`env-ol-${idx}`}>{items}</ol>);
  }
} else if (trimmed.startsWith('\\item')) {
  const content = trimmed.replace(/^\\item\s*/, '');
  if (envListStack.length === 0) {
    envListStack.push({ tag: 'ul', items: [] });
  }
  envListStack[envListStack.length - 1].items.push(
    <li key={`env-li-${idx}`}>{formatText(content)}</li>
  );
} else {
  envElements.push(
    <p key={`env-p-${idx}`} dangerouslySetInnerHTML={{ __html: formatText(line) }} />
  );
}
	  
    });

    elements.push(
      <Card className="mb-4" key={`env-${elements.length}`}>
        <Card.Body>
          <Card.Title>{environment.toUpperCase()}</Card.Title>
          {envElements}
        </Card.Body>
      </Card>
    );

    environment = null;
    environmentBuffer = [];
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
    if (environment) {
      if (line.trim() === `\\end{${environment}}`) {
        finalizeEnvironment();
      } else {
        environmentBuffer.push(line);
      }
      return;
    }

    if (line.trim().match(/^\\begin\{(content|process|knowledge)\}$/)) {
      environment = line.trim().match(/^\\begin\{(.*?)\}$/)[1];
    } else if (line.startsWith('\\begin{question}')) {
      const id = line.match(/\\begin\{question\}\{(.+?)\}/)?.[1];
      currentQuestion = { id, text: '', samples: [], feedback: [], followups: [], responseLines: 1 };
      currentField = 'text';
    } else if (line.startsWith('\\textresponse')) {
      const match = line.match(/\\textresponse\{.+?,(\d+)\}/);
      if (match) {
        currentQuestion.responseLines = parseInt(match[1]);
      }
    } else if (line.trim() === '\\sampleresponses') {
      currentField = 'samples';
    } else if (line.trim() === '\\endsampleresponses') {
      currentField = 'text';
    } else if (line.trim() === '\\feedbackprompt') {
      currentField = 'feedback';
    } else if (line.trim() === '\\endfeedbackprompt') {
      currentField = 'text';
    } else if (line.trim() === '\\followupprompt') {
      currentField = 'followups';
    } else if (line.trim() === '\\endfollowupprompt') {
      currentField = 'text';
    } else if (line.trim() === '\\end{question}') {
      finalizeQuestionBlock();
    } else if (currentQuestion) {
      if (currentField === 'text') {
        currentQuestion.text += (currentQuestion.text ? ' ' : '') + formatText(line);
      } else {
        currentQuestion[currentField].push(formatText(line));
      }
    } else if (line.startsWith('\\title{')) {
      finalizeQuestionBlock(); finalizeList(); finalizeEnvironment();
      const title = line.match(/\\title\{(.+?)\}/)?.[1];
      elements.push(<h2 key={`title-${i}`}>{title}</h2>);
    } else if (line.startsWith('\\name{')) {
      const name = line.match(/\\name\{(.+?)\}/)?.[1];
      elements.push(<h4 key={`name-${i}`}>Activity ID: {name}</h4>);
    } else if (line.startsWith('\\section{')) {
      finalizeQuestionBlock(); finalizeList(); finalizeEnvironment();
      const section = line.match(/\\section\{(.+?)\}/)?.[1];
      elements.push(<h3 key={`section-${i}`}>{section}</h3>);
    } else if (line === '\\roles') {
      finalizeQuestionBlock(); finalizeList(); finalizeEnvironment();
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
      elements.push(createPythonBlock(code, pythonBlockIndex));
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
  finalizeEnvironment();

  return (
    <Container>
      <h2>Preview: {activity?.title}</h2>
      {elements}
    </Container>
  );
}
