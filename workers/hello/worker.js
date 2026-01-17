export default {
  async fetch(request, env, ctx) {
    // Get client information
    const cf = request.cf || {};
    const clientIP = request.headers.get("CF-Connecting-IP") || 
                     request.headers.get("X-Forwarded-For") || 
                     "Unknown";
    
    // Get current time
    const now = new Date();
    const timeString = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    
    // Greetings in different languages
    const greetings = [
      { lang: "中文", greeting: "你好", description: "Chinese" },
      { lang: "English", greeting: "Hello", description: "English" },
      { lang: "日本語", greeting: "こんにちは", description: "Japanese" },
      { lang: "한국어", greeting: "안녕하세요", description: "Korean" },
      { lang: "Español", greeting: "Hola", description: "Spanish" },
      { lang: "Français", greeting: "Bonjour", description: "French" },
      { lang: "Deutsch", greeting: "Guten Tag", description: "German" },
      { lang: "Italiano", greeting: "Ciao", description: "Italian" },
      { lang: "Português", greeting: "Olá", description: "Portuguese" },
      { lang: "Русский", greeting: "Здравствуйте", description: "Russian" },
      { lang: "العربية", greeting: "مرحبا", description: "Arabic" },
      { lang: "हिन्दी", greeting: "नमस्ते", description: "Hindi" }
    ];

    // Build greeting rows
    const greetingRows = greetings.map(g => `
      <tr>
        <td><strong>${g.lang}</strong></td>
        <td class="greeting">${g.greeting}</td>
        <td class="description">${g.description}</td>
      </tr>
    `).join('');

    // Build HTML response
    const html = `
      <!DOCTYPE html>
      <html lang="zh-CN">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>你好 - Hello World</title>
          <style>
              * {
                  margin: 0;
                  padding: 0;
                  box-sizing: border-box;
              }
              body {
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
                  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                  min-height: 100vh;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  padding: 2rem;
              }
              .container {
                  max-width: 900px;
                  width: 100%;
                  background: rgba(255, 255, 255, 0.98);
                  backdrop-filter: blur(10px);
                  border-radius: 20px;
                  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                  overflow: hidden;
                  animation: fadeIn 0.5s ease-in;
              }
              @keyframes fadeIn {
                  from {
                      opacity: 0;
                      transform: translateY(20px);
                  }
                  to {
                      opacity: 1;
                      transform: translateY(0);
                  }
              }
              .header {
                  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                  color: white;
                  padding: 2rem;
                  text-align: center;
              }
              .header h1 {
                  font-size: 2.5rem;
                  font-weight: 700;
                  margin-bottom: 0.5rem;
                  text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.2);
              }
              .header p {
                  font-size: 1.1rem;
                  opacity: 0.95;
              }
              .info-section {
                  padding: 2rem;
                  background: #f8f9fa;
                  border-bottom: 1px solid #e9ecef;
              }
              .info-grid {
                  display: grid;
                  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                  gap: 1rem;
              }
              .info-item {
                  background: white;
                  padding: 1rem;
                  border-radius: 10px;
                  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
              }
              .info-item .label {
                  font-size: 0.85rem;
                  color: #6c757d;
                  margin-bottom: 0.25rem;
              }
              .info-item .value {
                  font-size: 1.1rem;
                  font-weight: 600;
                  color: #495057;
                  word-break: break-all;
              }
              .greetings-section {
                  padding: 2rem;
              }
              .greetings-section h2 {
                  color: #667eea;
                  margin-bottom: 1.5rem;
                  font-size: 1.8rem;
                  text-align: center;
              }
              table {
                  width: 100%;
                  border-collapse: separate;
                  border-spacing: 0 0.5rem;
              }
              tr {
                  background: white;
                  transition: all 0.3s ease;
              }
              tr:hover {
                  transform: translateX(5px);
                  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.2);
              }
              td {
                  padding: 1rem 1.5rem;
                  border: none;
              }
              td:first-child {
                  border-top-left-radius: 10px;
                  border-bottom-left-radius: 10px;
                  width: 25%;
                  color: #667eea;
                  font-weight: 600;
              }
              td.greeting {
                  font-size: 1.5rem;
                  font-weight: 700;
                  color: #764ba2;
                  width: 40%;
              }
              td.description {
                  color: #6c757d;
                  font-style: italic;
                  width: 35%;
              }
              td:last-child {
                  border-top-right-radius: 10px;
                  border-bottom-right-radius: 10px;
              }
              .footer {
                  background: #f8f9fa;
                  padding: 1.5rem;
                  text-align: center;
                  color: #6c757d;
                  font-size: 0.9rem;
              }
              .footer a {
                  color: #667eea;
                  text-decoration: none;
                  font-weight: 600;
              }
              .footer a:hover {
                  text-decoration: underline;
              }
              @media (max-width: 768px) {
                  .header h1 {
                      font-size: 2rem;
                  }
                  td {
                      padding: 0.75rem 1rem;
                  }
                  td.greeting {
                      font-size: 1.2rem;
                  }
              }
          </style>
      </head>
      <body>
          <div class="container">
              <div class="header">
                  <h1>🌍 你好，世界！</h1>
                  <p>Hello, World! - Greetings from around the globe</p>
              </div>
              
              <div class="info-section">
                  <div class="info-grid">
                      <div class="info-item">
                          <div class="label">Your IP Address</div>
                          <div class="value">${clientIP}</div>
                      </div>
                      <div class="info-item">
                          <div class="label">Location</div>
                          <div class="value">${cf.city || 'Unknown'}, ${cf.country || 'Unknown'}</div>
                      </div>
                      <div class="info-item">
                          <div class="label">Current Time</div>
                          <div class="value">${timeString}</div>
                      </div>
                      <div class="info-item">
                          <div class="label">Cloudflare POP</div>
                          <div class="value">${cf.colo || 'Unknown'}</div>
                      </div>
                  </div>
              </div>

              <div class="greetings-section">
                  <h2>✨ Greetings Around the World</h2>
                  <table>
                      ${greetingRows}
                  </table>
              </div>

              <div class="footer">
                  <p>Powered by Cloudflare Workers | <a href="https://github.com/felix2027/my_tools" target="_blank">View on GitHub</a></p>
              </div>
          </div>
      </body>
      </html>
    `;

    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=UTF-8",
        "Cache-Control": "no-store, max-age=0"
      }
    });
  }
};
