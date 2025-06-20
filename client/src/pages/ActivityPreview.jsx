// ActivityPreview.jsx
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Container } from 'react-bootstrap';
import Prism from 'prismjs';
import 'prismjs/themes/prism.css';
import 'prismjs/components/prism-python';
import { parseSheetToBlocks, renderBlocks } from '../utils/parseSheet';

import { API_BASE_URL } from '../config';

export default function ActivityPreview() {
  const { activityId } = useParams();
  const [activity, setActivity] = useState(null);
  const [sheetData, setSheetData] = useState([]);
  const [elements, setElements] = useState([]);
  const [skulptLoaded, setSkulptLoaded] = useState(false); // ✅

  useEffect(() => {
    const loadScript = (src) =>
      new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
          resolve(); // already loaded
          return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => {
          console.log(`✅ Loaded ${src}`);
          resolve();
        };
        script.onerror = () => {
          console.error(`❌ Failed to load ${src}`);
          reject(new Error(`Failed to load script ${src}`));
        };
        document.head.appendChild(script); // use <head> for better priority
      });

    const loadSkulpt = async () => {
      try {
        await loadScript('https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt.min.js');
        await loadScript('https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt-stdlib.js');

        if (window.Sk && window.Sk.builtinFiles) {
          console.log('✅ Skulpt is ready');
          setSkulptLoaded(true);
        } else {
          console.warn('⚠️ Skulpt scripts loaded, but core objects not initialized');
        }
      } catch (err) {
        console.error('🚨 Skulpt failed to load', err);
      }
    };

    loadSkulpt();
  }, []);


  useEffect(() => {
    const fetchActivityAndSheet = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/activities/${activityId}`);
        const activityData = await res.json();
        setActivity(activityData);
        console.log("🧾 activityData.sheet_url =", activityData.sheet_url);


        // ✅ Add this guard to prevent undefined docUrl fetch
        if (!activityData.sheet_url || activityData.sheet_url === 'undefined') {
          console.warn("❌ Skipping doc preview because sheet_url is missing:", activityData.sheet_url);
          return;
        }

        const docRes = await fetch(`${API_BASE_URL}/api/activities/preview-doc?docUrl=${encodeURIComponent(activityData.sheet_url)}`);
        const { lines } = await docRes.json();
        const blocks = parseSheetToBlocks(lines);
        const rendered = renderBlocks(blocks, { mode: 'preview' });
        setElements(rendered);
      } catch (err) {
        console.error("Failed to fetch preview data", err);
      }
    };
    if (skulptLoaded) {
      fetchActivityAndSheet(); // ✅ Only fetch once Skulpt is loaded
    }
  }, [activityId, skulptLoaded]);

  useEffect(() => {
    Prism.highlightAll();
  }, [elements]);

  return (
    <Container>
      <h2>Preview: {activity?.title}</h2>
      {!skulptLoaded
        ? <p>Loading Python engine (Skulpt)...</p>
        : elements
      }
    </Container>
  );
}
