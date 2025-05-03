// src/pages/ActivityPreview.jsx
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Container } from 'react-bootstrap';
import Prism from 'prismjs';
import 'prismjs/themes/prism.css';
import 'prismjs/components/prism-python';

import { parseSheetToBlocks, renderBlocks } from '../utils/parseSheet.jsx';
import { API_BASE_URL } from '../config';

export default function ActivityPreview() {
  const { activityId } = useParams();
  const [activity, setActivity] = useState(null);
  const [elements, setElements] = useState([]);

  // Fetch activity metadata and sheet content
  useEffect(() => {
    const fetchActivityAndSheet = async () => {
      try {
        console.log("activityId:", activityId);
        const res = await fetch(`${API_BASE_URL}/api/activities/${activityId}`);
        const activityData = await res.json();
        console.log("✅ Loaded activityData:", activityData);
        setActivity(activityData);

        const docRes = await fetch(
          `${API_BASE_URL}/api/activities/preview-doc?docUrl=${encodeURIComponent(activityData.sheet_url)}`
        );
        const { lines } = await docRes.json();
        console.log("📄 Raw lines from doc:", lines);

        const blocks = parseSheetToBlocks(lines);
        const rendered = renderBlocks(blocks);
        setElements(rendered);
      } catch (err) {
        console.error("❌ Failed to fetch preview data", err);
      }
    };

    fetchActivityAndSheet();
  }, [activityId]);

  // Re-highlight Python code when content is updated
  useEffect(() => {
    Prism.highlightAll();
  }, [elements]);

  // Load Skulpt for code execution support
  useEffect(() => {
    const loadScript = (src) =>
      new Promise((resolve, reject) => {
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
        console.error('❌ Failed to load Skulpt', err);
      }
    };

    loadSkulpt();
  }, []);

  return (
    <Container>
      <h2>Preview: {activity?.title}</h2>
      {elements}
    </Container>
  );
}
