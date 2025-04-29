import React from 'react';
import { Form, Table } from 'react-bootstrap';

export default function ActivityQuestionBlock({ question, editable = false }) {
  return (
    <div className="mb-4">
      <p dangerouslySetInnerHTML={{ __html: question.text }} />
      {editable ? (
        <Form.Control as="textarea" rows={question.responseLines || 1} placeholder="Your response..." />
      ) : (
        <Form.Control as="textarea" disabled value="(Student will answer here in Run mode)" rows={question.responseLines || 1} />
      )}
      {question.samples.length > 0 && (
        <>
          <h6>Sample Responses</h6>
          <Table bordered size="sm">
            <tbody>
              {question.samples.map((r, idx) => <tr key={idx}><td>{r}</td></tr>)}
            </tbody>
          </Table>
        </>
      )}
      {question.feedback.length > 0 && (
        <>
          <h6>Feedback Prompts</h6>
          <Table bordered size="sm">
            <tbody>
              {question.feedback.map((r, idx) => <tr key={idx}><td>{r}</td></tr>)}
            </tbody>
          </Table>
        </>
      )}
      {question.followups.length > 0 && (
        <>
          <h6>Followup Prompts</h6>
          <Table bordered size="sm">
            <tbody>
              {question.followups.map((r, idx) => <tr key={idx}><td>{r}</td></tr>)}
            </tbody>
          </Table>
        </>
      )}
    </div>
  );
}
