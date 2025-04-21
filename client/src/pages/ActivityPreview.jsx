// ActivityPreview.jsx
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { API_BASE_URL } from '../config';
import { Container, Table, Form } from 'react-bootstrap';

export default function ActivityPreview() {
  const { activityName } = useParams();
  const [activity, setActivity] = useState(null);
  const [sheetData, setSheetData] = useState([]);
  const [loading, setLoading] = useState(true);

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
      } finally {
        setLoading(false);
      }
    };

    fetchActivityAndSheet();
  }, [activityName]);

  if (loading) return <p>Loading preview...</p>;
  if (!activity) return <p>Activity not found.</p>;

  // States for current question block
  let currentQuestion = null;
  let elements = [];

  const finalizeQuestionBlock = () => {
    if (currentQuestion) {
      elements.push(
        <div key={currentQuestion.id} style={{ marginBottom: '30px' }}>
          <h5>Question: {currentQuestion.text}</h5>
          <Form.Control as="textarea" rows={currentQuestion.responseLines || 1} placeholder="Your response..." className="mb-2" />
          {currentQuestion.samples.length > 0 && (
            <>
              <h6>Sample Responses</h6>
              <Table bordered size="sm"><tbody>{currentQuestion.samples.map((r, i) => <tr key={i}><td>{r}</td></tr>)}</tbody></Table>
            </>
          )}
          {currentQuestion.feedback.length > 0 && (
            <>
              <h6>Feedback Prompts</h6>
              <Table bordered size="sm"><tbody>{currentQuestion.feedback.map((f, i) => <tr key={i}><td>{f}</td></tr>)}</tbody></Table>
            </>
          )}
          {currentQuestion.followups.length > 0 && (
            <>
              <h6>Followup Prompts</h6>
              <Table bordered size="sm"><tbody>{currentQuestion.followups.map((f, i) => <tr key={i}><td>{f}</td></tr>)}</tbody></Table>
            </>
          )}
        </div>
      );
      currentQuestion = null;
    }
  };

  sheetData.forEach((line, i) => {
    if (line.startsWith('\\title{')) {
      const title = line.match(/\\title\{(.+?)\}/)?.[1];
      elements.push(<h2 key={`title-${i}`}>{title}</h2>);
    } else if (line.startsWith('\\name{')) {
      const name = line.match(/\\name\{(.+?)\}/)?.[1];
      elements.push(<h4 key={`name-${i}`}>Activity ID: {name}</h4>);
    } else if (line.startsWith('\\section{')) {
      finalizeQuestionBlock();
      const section = line.match(/\\section\{(.+?)\}/)?.[1];
      elements.push(<h3 key={`section-${i}`}>{section}</h3>);
    } else if (line === '\\roles') {
      finalizeQuestionBlock();
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
      finalizeQuestionBlock();
      const id = line.match(/\\question\{(.+?)\}/)?.[1];
      currentQuestion = {
        id,
        text: '',
        responseLines: 1,
        samples: [],
        feedback: [],
        followups: []
      };
    } else if (currentQuestion && currentQuestion.text === '') {
      currentQuestion.text = line;
    } else if (line.startsWith('\\textresponse')) {
      const match = line.match(/\\textresponse\{.+?,(\d+)\}/);
      currentQuestion.responseLines = match ? parseInt(match[1]) : 1;
    } else if (line === '\\sampleresponses') {
      // handled in next lines
    } else if (currentQuestion && elements[elements.length - 1]?.type === 'table') {
      // skip
    } else if (line === '\\feedbackprompt') {
      // handled in next lines
    } else if (line === '\\followupprompt') {
      // handled in next lines
    } else if (currentQuestion) {
      // determine what type the line is
      const prev = sheetData[i - 1];
      if (prev === '\\sampleresponses') {
        currentQuestion.samples.push(line);
      } else if (prev === '\\feedbackprompt') {
        currentQuestion.feedback.push(line);
      } else if (prev === '\\followupprompt') {
        currentQuestion.followups.push(line);
      } else {
        currentQuestion.text += ' ' + line;
      }
    } else {
      elements.push(<p key={`p-${i}`}>{line}</p>);
    }
  });

  finalizeQuestionBlock();

  return (
    <Container>
      <h2>Preview: {activity.title}</h2>
      {elements}
    </Container>
  );
}
