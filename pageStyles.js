exports.css = `
  body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
  }

  h1, h2, h3, h4, h5, h6 {
      color: #0696D7;
      margin-top: 30px;
  }

  #breadCrumbs {
      background-color: #f5f5f5;
      padding: 10px;
      margin-bottom: 20px;
      border-radius: 5px;
  }

  #breadCrumbs a {
      color: #0696D7;
      text-decoration: none;
  }

  #breadCrumbs a:hover {
      text-decoration: underline;
  }

  .highlight {
      background-color: #f8f8f8;
      border: 1px solid #ddd;
      border-radius: 5px;
      padding: 15px;
      margin: 15px 0;
      position: relative;
  }

  .highlight pre {
      margin: 0;
      white-space: pre-wrap;
  }

  .copy-button {
      position: absolute;
      top: 5px;
      right: 5px;
      background-color: #0696D7;
      color: white;
      border: none;
      border-radius: 3px;
      padding: 5px 10px;
      cursor: pointer;
  }

  .copy-button:hover {
      background-color: #0570a3;
  }

  table {
      border-collapse: collapse;
      width: 100%;
      margin: 15px 0;
  }

  th, td {
      border: 1px solid #ddd;
      padding: 8px;
      text-align: left;
  }

  th {
      background-color: #f2f2f2;
  }

  img {
      max-width: 100%;
      height: auto;
  }
`;

exports.js = `
  function copyToClipboard(button) {
    const pre = button.nextElementSibling;
    const textArea = document.createElement('textarea');
    textArea.value = pre.textContent;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    button.textContent = 'Copied!';
    setTimeout(() => {
      button.textContent = 'Copy';
    }, 2000);
  }

  document.addEventListener('DOMContentLoaded', (event) => {
    document.querySelectorAll('pre').forEach((block) => {
      const button = document.createElement('button');
      button.textContent = 'Copy';
      button.className = 'copy-button';
      button.onclick = function() { copyToClipboard(this); };
      block.parentNode.insertBefore(button, block);
    });
  });
`;
