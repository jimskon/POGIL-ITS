import React, { useEffect, useState } from "react";
import Prism from "prismjs";
import { Form } from "react-bootstrap";
import { io } from "socket.io-client";

const socket = io(); // Adjust if backend runs on a different origin

export default function ActivityPythonBlock({
  code,
  blockIndex,
  editable = false,
  groupId = null,
}) {
  const [output, setOutput] = useState("");
  const [inputCode, setInputCode] = useState(code);

  useEffect(() => {
    Prism.highlightAll();
  }, [inputCode]);

  useEffect(() => {
    if (!groupId) return;

    socket.emit("joinGroup", groupId);
    console.log(`🟢 Joined socket group-${groupId}`);

    const handleAIResponse = (data) => {
      console.log("📡 Received AI feedback:", data);
      setOutput(
        (prev) =>
          prev + `\n\n[AI Feedback]: ${data.followupQuestion || "✔️ Complete"}`
      );
    };

    socket.on("aiFollowupFeedback", handleAIResponse);

    return () => {
      socket.off("aiFollowupFeedback", handleAIResponse);
    };
  }, [groupId]);

  const runCode = () => {
    setOutput("");

    window.Sk.configure({
      output: (text) => setOutput((prev) => prev + text),
      read: (x) => {
        if (!window.Sk.builtinFiles || !window.Sk.builtinFiles["files"][x]) {
          throw new Error(`File not found: '${x}'`);
        }
        return window.Sk.builtinFiles["files"][x];
      },
    });

    window.Sk.misceval
      .asyncToPromise(() =>
        window.Sk.importMainWithBody("<stdin>", false, inputCode)
      )
      .catch((err) => setOutput(err.toString()));
  };

  return (
    <div className="mb-4">
      {editable ? (
        <Form.Control
          as="textarea"
          rows={6}
          value={inputCode}
          onChange={(e) => setInputCode(e.target.value)}
        />
      ) : (
        <pre className="bg-light p-3 rounded">
          <code className="language-python">{inputCode}</code>
        </pre>
      )}

      <button className="btn btn-primary btn-sm mt-2" onClick={runCode}>
        Run
      </button>

      <pre className="mt-2 bg-dark text-light p-2 rounded">{output}</pre>
    </div>
  );
}
