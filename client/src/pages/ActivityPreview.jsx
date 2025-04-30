import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Container } from 'react-bootstrap';
import Prism from 'prismjs';
import 'prismjs/themes/prism.css';
import 'prismjs/components/prism-python';

import ActivityHeader from '../components/activity/ActivityHeader';
import ActivityEnvironment from '../components/activity/ActivityEnvironment';
import ActivityQuestionBlock from '../components/activity/ActivityQuestionBlock';
import ActivityPythonBlock from '../components/activity/ActivityPythonBlock';

import { API_BASE_URL } from '../config';

export default function ActivityPreview() {
  const { activityId } = useParams();
  const [activity, setActivity] = useState(null);
  const [sheetData, setSheetData] = useState([]);

  // State for blocks
  const [elements, setElements] = useState([]);

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
  if (Array.isArray(sheetData) && sheetData.length > 0) {
    Prism.highlightAll();
  }
}, [sheetData]);
  useEffect(() => {
    const fetchActivityAndSheet = async () => {
	try {
	    console.log("activityId:",activityId);
        const res = await fetch(`${API_BASE_URL}/api/activities/${activityId}`);
          const activityData = await res.json();
	console.log("✅ Loaded activityData:", activityData);
  
        setActivity(activityData);
	  console.log("URL!!!!:",activityData.name,activityData.sheet_url);
        const docRes = await fetch(`${API_BASE_URL}/api/activities/preview-doc?docUrl=${encodeURIComponent(activityData.sheet_url)}`);
        const { lines } = await docRes.json();
        setSheetData(lines);
      } catch (err) {
        console.error("Failed to fetch preview data", err);
      }
    };
    fetchActivityAndSheet();
  }, [activityId]);

  useEffect(() => {
    // Parse the sheet when sheetData changes
    if (sheetData.length > 0) {
      parseSheet();
    }
  }, [sheetData]);

  const parseSheet = () => {
    let blocks = [];

    let currentEnv = null;
    let envBuffer = [];
    let currentQuestion = null;
    let collectingSamples = false;
    let collectingFeedback = false;
    let collectingFollowups = false;
    let currentField = 'text';
    let pythonBlock = null;
    let pythonBlockIndex = 0;
    let inList = false;
    let listType = null;
    let listItems = [];

    const formatText = (text) =>
      text.replace(/\\textit\{([^}]+)\}/g, '<em>$1</em>')
          .replace(/\\textbf\{([^}]+)\}/g, '<strong>$1</strong>');

    const finalizeEnvironment = () => {
      if (currentEnv) {
        blocks.push(
          <ActivityEnvironment
            key={`env-${blocks.length}`}
            type={currentEnv}
            content={envBuffer.map(line => formatText(line))}
          />
        );
        currentEnv = null;
        envBuffer = [];
      }
    };

    const finalizeQuestion = () => {
      if (currentQuestion) {
        blocks.push(
          <ActivityQuestionBlock
            key={currentQuestion.id}
            question={currentQuestion}
            editable={false}
          />
        );
        currentQuestion = null;
      }
    };

    sheetData.forEach((line, index) => {
      const trimmed = line.trim();

      // --- Environment blocks ---
if (currentEnv) {
  if (trimmed === `\\end{${currentEnv}}`) {
    finalizeEnvironment();
  } else if (trimmed === '\\begin{itemize}' || trimmed === '\\begin{enumerate}') {
    envBuffer.push(`<${trimmed.includes('itemize') ? 'ul' : 'ol'}>`);
  } else if (trimmed === '\\end{itemize}' || trimmed === '\\end{enumerate}') {
    envBuffer.push(`</${trimmed.includes('itemize') ? 'ul' : 'ol'}>`);
  } else if (trimmed.startsWith('\\item')) {
    envBuffer.push(`<li>${formatText(trimmed.replace(/^\\item\s*/, ''))}</li>`);
  } else {
    envBuffer.push(trimmed);
  }
  return;
}

      // --- Start new environment ---
      const envMatch = trimmed.match(/^\\begin\{(content|process|knowledge)\}$/);
      if (envMatch) {
        currentEnv = envMatch[1];
        return;
      }

      // --- Start a question ---
      if (trimmed.startsWith('\\begin{question}')) {
        const id = trimmed.match(/\\begin\{question\}\{(.+?)\}/)?.[1];
        currentQuestion = { id, text: '', samples: [], feedback: [], followups: [], responseLines: 1 };
        currentField = 'text';
        return;
      }

      if (trimmed.startsWith('\\textresponse')) {
        const match = trimmed.match(/\\textresponse\{.+?,(\d+)\}/);
        if (match) currentQuestion.responseLines = parseInt(match[1]);
        return;
      }

      if (trimmed === '\\sampleresponses') {
        collectingSamples = true;
        currentField = 'samples';
        return;
      }
      if (trimmed === '\\endsampleresponses') {
        collectingSamples = false;
        currentField = 'text';
        return;
      }

      if (trimmed === '\\feedbackprompt') {
        collectingFeedback = true;
        currentField = 'feedback';
        return;
      }
      if (trimmed === '\\endfeedbackprompt') {
        collectingFeedback = false;
        currentField = 'text';
        return;
      }

      if (trimmed === '\\followupprompt') {
        collectingFollowups = true;
        currentField = 'followups';
        return;
      }
      if (trimmed === '\\endfollowupprompt') {
        collectingFollowups = false;
        currentField = 'text';
        return;
      }

      if (trimmed === '\\end{question}') {
        finalizeQuestion();
        return;
      }
// Handle itemize/enumerate blocks
if (trimmed === '\\begin{itemize}' || trimmed === '\\begin{enumerate}') {
  inList = true;
  listType = trimmed.includes('itemize') ? 'ul' : 'ol';
  listItems = [];
  return;
}

if (trimmed === '\\end{itemize}' || trimmed === '\\end{enumerate}') {
  const Tag = listType;
  blocks.push(
    <Tag key={`list-${blocks.length}`}>
      {listItems.map((item, i) => <li key={i} dangerouslySetInnerHTML={{ __html: formatText(item) }} />)}
    </Tag>
  );
  inList = false;
  listType = null;
  listItems = [];
  return;
}

if (inList && trimmed.startsWith('\\item')) {
  listItems.push(trimmed.replace(/^\\item\s*/, ''));
  return;
}

      if (currentQuestion) {
        if (currentField === 'text') {
          currentQuestion.text += (currentQuestion.text ? ' ' : '') + formatText(line);
        } else {
          currentQuestion[currentField].push(formatText(line));
        }
        return;
      }

      // --- Special block markers ---
      if (trimmed.startsWith('\\title{')) {
        const title = trimmed.match(/\\title\{(.+?)\}/)?.[1];
        blocks.push(<ActivityHeader key={`title-${index}`} title={title} />);
      } else if (trimmed.startsWith('\\name{')) {
        const name = trimmed.match(/\\name\{(.+?)\}/)?.[1];
        blocks.push(<ActivityHeader key={`name-${index}`} name={name} />);
      } else if (trimmed.startsWith('\\section{')) {
        const section = trimmed.match(/\\section\{(.+?)\}/)?.[1];
        blocks.push(<ActivityHeader key={`section-${index}`} section={section} />);
      } else if (trimmed === '\\python') {
        pythonBlock = [];
      } else if (trimmed === '\\endpython') {
        const code = pythonBlock.join("\n");
        blocks.push(
          <ActivityPythonBlock
            key={`py-${pythonBlockIndex}`}
            code={code}
            blockIndex={pythonBlockIndex}
          />
        );
        pythonBlockIndex++;
        pythonBlock = null;
      } else if (pythonBlock !== null) {
        pythonBlock.push(line);
      } else {
        blocks.push(
          <p key={`p-${index}`} dangerouslySetInnerHTML={{ __html: formatText(line) }} />
        );
      }
    });

    finalizeQuestion();
    finalizeEnvironment();
    setElements(blocks);
  };

  return (
    <Container>
      <h2>Preview: {activity?.title}</h2>
      {elements}
    </Container>
  );
}
