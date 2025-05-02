// utils/parseSheet.js

export function parseSheetHTML(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const body = doc.body;

  const blocks = [];
  let currentBlock = null;

  Array.from(body.children).forEach((el) => {
    const text = el.innerText.trim();

    if (text.startsWith('\\question{')) {
      if (currentBlock) blocks.push(currentBlock);
      const id = text.match(/\\question\{(.+?)\}/)?.[1] || `q${blocks.length + 1}`;
      currentBlock = { type: 'question', id, content: '' };
    } else if (text.startsWith('\\python')) {
      if (currentBlock) blocks.push(currentBlock);
      currentBlock = { type: 'code', language: 'python', content: '' };
    } else if (text.startsWith('\\textresponse')) {
      if (currentBlock) blocks.push(currentBlock);
      currentBlock = { type: 'textresponse', content: '' };
    } else if (text.startsWith('\\feedbackprompt')) {
      if (currentBlock) blocks.push(currentBlock);
      currentBlock = { type: 'feedbackprompt', content: '' };
    } else if (text.startsWith('\\')) {
      // Skip other commands
    } else {
      // Regular content
      if (!currentBlock) {
        currentBlock = { type: 'info', content: '' };
      }
      currentBlock.content += el.outerHTML;
    }
  });

  if (currentBlock) blocks.push(currentBlock);
  return blocks;
}
