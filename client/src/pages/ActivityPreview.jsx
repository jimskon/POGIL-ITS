// ActivityPreview.jsx
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
  const [sheetData, setSheetData] = useState([]);
  //const [elements, setElements] = useState([]);
  const [skulptLoaded, setSkulptLoaded] = useState(false);
  const [fileContents, setFileContents] = useState({});
  const [blocks, setBlocks] = useState([]);
  const [renderedElements, setRenderedElements] = useState([]);
  const fileContentsRef = useRef({});

  const handleUpdateFileContents = (updaterFn) => {
    setFileContents((prev) => {
      const updated = updaterFn(prev);
      fileContentsRef.current = updated; // keep ref in sync
      return updated;
    });
  };


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
        //await loadScript('/skulpt/skulpt.min.js');
        //await loadScript('/skulpt/skulpt-stdlib.js');
        await loadScript('https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt.min.js');
        await loadScript('https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt-stdlib.js');
        console.log("✅ Skulpt scripts loaded");

        if (window.Sk) {
          console.log("✅ Skulpt version:", Sk.version);
          console.log("✅ Skulpt file system support?", typeof Sk.fs !== 'undefined');

          // ✅ Define Sk.fs manually if missing
          if (!Sk.fs) {
            console.log("⚙️ Injecting in-memory file system support into Sk");
            Sk.fs = (function () {
              const files = {};

              return {
                writeFile: (name, content) => {
                  files[name] = typeof content === "string" ? content : content.toString();
                },
                readFile: (name) => {
                  if (!(name in files)) throw new Sk.builtin.IOError(`No such file: ${name}`);
                  return files[name];
                },
                exists: (name) => name in files,
                deleteFile: (name) => { delete files[name]; },
                listFiles: () => Object.keys(files),
              };
            })();
          }

          if (Sk.builtinFiles) {
            console.log('✅ Skulpt is ready');
            setSkulptLoaded(true);
          } else {
            console.warn('⚠️ Skulpt loaded but builtinFiles missing');
          }
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
        const parsed = parseSheetToBlocks(lines);

        // 🔥 Extract file contents into a map
        const files = {};
        for (const block of parsed) {
          if (block.type === 'file' && block.filename && block.content) {
            files[block.filename] = block.content;
          }
        }
        setBlocks(parsed);         // save parsed blocks to state
        setFileContents(files);    //  makes the files available to Skulpt

        setBlocks(parsed);         // save parsed blocks to state
        setFileContents(files);    // updates state for preview and editing
        fileContentsRef.current = files;

      } catch (err) {
        console.error("Failed to fetch preview data", err);
      }
    };

    if (skulptLoaded) {
      fetchActivityAndSheet(); // Only fetch once Skulpt is loaded
    }
  }, [activityId, skulptLoaded]);

  /*useEffect(() => {
    console.log("🧾 Preview fileContents:", fileContents);
  }, [fileContents]);*/

  useEffect(() => {
    console.log("🔁 Rendering blocks due to [blocks]");
    const rendered = renderBlocks(blocks, {
      mode: 'preview',
      editable: true,
      fileContentsRef,
      setFileContents: handleUpdateFileContents, // ✅ FIXED
    });
    setRenderedElements(rendered);
  }, [blocks]);



  useEffect(() => {
    Prism.highlightAll();
  }, [renderedElements]);

  return (
    <Container>
      <h2>Preview: {activity?.title}</h2>
      {!skulptLoaded
        ? <p>Loading Python engine (Skulpt)...</p>
        : renderedElements
      }
    </Container>
  );
}
