// ActivityPreview.jsx
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { API_BASE_URL } from '../config';

export default function ActivityPreview() {
    const { activityName } = useParams();
    const [activity, setActivity] = useState(null);
    const [sheetData, setSheetData] = useState([]);
    const [loading, setLoading] = useState(true);

    console.log("API_BASE_URL =", API_BASE_URL);

    console.log("activityName:",activityName);
    useEffect(() => {
	const fetchActivityAndSheet = async () => {
	    try {
		const res = await fetch(`${API_BASE_URL}/activities/${activityName}`);
		const activityData = await res.json();
    console.log("Doc URL encoded:", encodeURIComponent(activityData.sheet_url));
		setActivity(activityData);

                const docRes = await fetch(`${API_BASE_URL}/activities/preview-doc?docUrl=${encodeURIComponent(activityData.sheet_url)}`);

		if (!docRes.ok) {
		    throw new Error("Failed to fetch Google Doc preview");
		}
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

    return (
	<div>
	    <h2>Preview: {activity.title}</h2>
	    {sheetData.map((line, i) => {
		if (line.startsWith("\\title{")) {
		    return <h2 key={i}>{line.match(/\\title\{(.+?)\}/)[1]}</h2>;
		}
		if (line.startsWith("\\section{")) {
    return <h3 key={i}>{line.match(/\\section\{(.+?)\}/)[1]}</h3>;
  }
  if (line.startsWith("\\question{")) {
    return <p key={i}><strong>Question:</strong> {line.match(/\\question\{(.+?)\}/)[1]}</p>;
  }
  if (line.startsWith("\\textanswer")) {
    return <textarea key={i} rows={3} style={{ width: '100%' }} placeholder="Your answer here" />;
  }
  if (line.startsWith("@code")) {
    return <textarea key={i} rows={6} style={{ width: '100%', fontFamily: 'monospace' }} placeholder="Write code here..." />;
  }
  return <p key={i}>{line}</p>;
})}

    </div>
  );
}
