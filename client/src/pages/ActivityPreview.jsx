// client/src/pages/ActivityPreview.jsx
import React, { useEffect, useState, useRef } from 'react';
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
  const [blocks, setBlocks] = useState([]);
  const [fileContents, setFileContents] = useState({});
  const [renderedElements, setRenderedElements] = useState([]);
  const [skulptLoaded, setSkulptLoaded] = useState(false);

  // NEW: local state used by renderBlocks / code blocks
  const [codeViewMode, setCodeViewMode] = useState({}); // { responseKey: 'active'|'local' }
  const [localCode, setLocalCode] = useState({});       // { responseKey: string }

  const fetchedRef = useRef(false);

  const handleUpdateFileContents = (updaterFn) => {
    setFileContents((prev) => updaterFn(prev));
  };

  // Toggle between authored / local view for a given code cell
  const toggleCodeViewMode = (responseKey, nextMode) => {
    setCodeViewMode((prev) => ({
      ...prev,
      [responseKey]: nextMode,
    }));
  };

  // Track local edits to code cells (preview is local-only)
  const updateLocalCode = (responseKey, updated) => {
    setLocalCode((prev) => ({
      ...prev,
      [responseKey]: updated,
    }));
  };

  // Called by renderBlocks / Activity*Block when code changes in preview
  const handleCodeChange = (responseKey, updatedCode) => {
    // No backend save in preview. Just keep it locally editable.
    setLocalCode((prev) => ({
      ...prev,
      [responseKey]: updatedCode,
    }));
  };

  useEffect(() => {
    const loadScript = (src) =>
      new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
          resolve();
          return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load script ${src}`));
        document.head.appendChild(script);
      });

    const loadSkulpt = async () => {
      try {
        await loadScript('https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt.min.js');
        await loadScript('https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt-stdlib.js');

        if (window.Sk) {
          if (!Sk.fs) {
            const files = {};
            Sk.fs = {
              writeFile: (name, content) => {
                files[name] = typeof content === 'string' ? content : content.toString();
              },
              readFile: (name) => {
                if (!(name in files)) throw new Sk.builtin.IOError(`No such file: ${name}`);
                return files[name];
              },
              exists: (name) => name in files,
              deleteFile: (name) => { delete files[name]; },
              listFiles: () => Object.keys(files),
            };
          }
          if (Sk.builtinFiles) {
            setSkulptLoaded(true);
          } else {
            console.warn('Skulpt loaded but builtinFiles missing');
          }
        }
      } catch (err) {
        console.error('Skulpt failed to load', err);
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

        if (!activityData.sheet_url || activityData.sheet_url === 'undefined') {
          console.warn('Skipping doc preview because sheet_url is missing:', activityData.sheet_url);
          return;
        }

        const docRes = await fetch(
          `${API_BASE_URL}/api/activities/preview-doc?docUrl=${encodeURIComponent(activityData.sheet_url)}`
        );
        const { lines } = await docRes.json();
        const parsed = parseSheetToBlocks(lines);

        const files = {};
        for (const block of parsed) {
          if (block.type === 'file' && block.filename) {
            files[block.filename] = block.content || '';
          }
        }

        setBlocks(parsed);
        setFileContents(files);
      } catch (err) {
        console.error('Failed to fetch preview data', err);
      }
    };

    if (skulptLoaded && !fetchedRef.current) {
      fetchedRef.current = true;
      fetchActivityAndSheet();
    }
  }, [activityId, skulptLoaded]);

  useEffect(() => {
    const rendered = renderBlocks(blocks, {
      mode: 'preview',
      editable: true,
      isActive: true,              // allow editing in preview
      isObserver: false,
      allowLocalToggle: true,      // needed for Edit / View buttons
      fileContents,
      setFileContents: handleUpdateFileContents,

      // hook up code editing just like RunActivityPage (but local-only)
      codeViewMode,
      onToggleViewMode: toggleCodeViewMode,
      localCode,
      onLocalCodeChange: updateLocalCode,
      onCodeChange: handleCodeChange,
    });
    setRenderedElements(rendered);
  }, [blocks, fileContents, codeViewMode, localCode]);

  useEffect(() => {
    Prism.highlightAll();
  }, [renderedElements]);

  return (
    <Container>
      <h2>Preview: {activity?.title}</h2>
      {!skulptLoaded ? (
        <p>Loading Python engine (Skulpt)...</p>
      ) : (
        renderedElements
      )}
    </Container>
  );
}
