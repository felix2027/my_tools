addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request));
  });
  
  // 全局安全响应头：允许加载 Google Fonts，允许页面中内联脚本执行
  const defaultHeaders = {
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com;"
  };
  
  
  // 编码转换工具对象，支持 base64、hex 及 base64url
  const Encodings = {
    base64: {
      encode: arrayBufferToBase64,
      decode: base64ToArrayBuffer
    },
    hex: {
      encode: arrayBufferToHex,
      decode: hexToArrayBuffer
    },
    base64url: {
      encode: (buffer) => {
        let b64 = arrayBufferToBase64(buffer);
        return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      },
      decode: (str) => {
        let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4) {
          b64 += '=';
        }
        return base64ToArrayBuffer(b64);
      }
    }
  };
  
  /**
   * 主请求处理函数，根据请求方法和路径分发
   */
  async function handleRequest(request) {
    const url = new URL(request.url);
  
    if (request.method === 'GET') {
      return new Response(html, {
        headers: { 'Content-Type': 'text/html;charset=UTF-8', ...defaultHeaders }
      });
    } else if (request.method === 'POST') {
      if (url.pathname === '/encrypt') {
        return handleEncrypt(request);
      } else if (url.pathname === '/decrypt') {
        return handleDecrypt(request);
      } else {
        return new Response('Not Found', { status: 404, headers: defaultHeaders });
      }
    } else {
      return new Response('Method Not Allowed', { status: 405, headers: defaultHeaders });
    }
  }
  
  /**
   * 处理加密请求
   * 接收 JSON 格式数据：{ plaintext, password, algorithm, iterations }
   * 可通过 URL 参数 ?encoding=base64|hex|base64url 指定编码格式（默认 base64）
   */
  async function handleEncrypt(request) {
    try {
      const data = await request.json();
      const errMsg = validateEncrypt(data);
      if (errMsg) {
        return new Response(
          JSON.stringify({ error: errMsg }),
          { status: 400, headers: { ...defaultHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const { plaintext, password } = data;
      if (password.length < 8) {
        return new Response(
          JSON.stringify({ error: "密码至少8位" }),
          { status: 400, headers: { ...defaultHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const enc = new TextEncoder();
  
      const encodingParam = new URL(request.url).searchParams.get('encoding') || 'base64';
      const encoding = Encodings[encodingParam] || Encodings['base64'];
  
      // 算法选择：默认 AES-GCM，也可选 AES-CBC
      const algorithm = data.algorithm || 'AES-GCM';
      // 根据算法确定 IV 长度：AES-GCM 推荐 12 字节，AES-CBC 使用 16 字节
      const ivLength = algorithm === 'AES-GCM' ? 12 : 16;
      const iv = crypto.getRandomValues(new Uint8Array(ivLength));
      // 生成随机 salt（16 字节）
      const salt = crypto.getRandomValues(new Uint8Array(16));
      // 迭代次数：默认 100000（OWASP 推荐值），可通过 JSON 参数指定
      const iterations = data.iterations ? parseInt(data.iterations) : 100000;
      // 派生密钥
      const key = await deriveKey(password, salt, iterations, algorithm);
  
      let encrypted;
      if (algorithm === 'AES-GCM') {
        encrypted = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv: iv },
          key,
          enc.encode(plaintext)
        );
      } else if (algorithm === 'AES-CBC') {
        encrypted = await crypto.subtle.encrypt(
          { name: "AES-CBC", iv: iv },
          key,
          enc.encode(plaintext)
        );
      } else {
        return new Response(
          JSON.stringify({ error: "不支持的算法" }),
          { status: 400, headers: { ...defaultHeaders, 'Content-Type': 'application/json' } }
        );
      }
  
      const responseData = {
        ciphertext: encoding.encode(encrypted),
        iv: encoding.encode(iv),
        salt: encoding.encode(salt),
        algorithm,
        iterations
      };
      return new Response(
        JSON.stringify(responseData),
        { headers: { ...defaultHeaders, 'Content-Type': 'application/json' } }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err.toString() }),
        { status: 500, headers: { ...defaultHeaders, 'Content-Type': 'application/json' } }
      );
    }
  }
  
  /**
   * 处理解密请求
   * 接收 JSON 格式数据：{ ciphertext, iv, salt, password, algorithm, iterations }
   * 同样通过 URL 参数指定编码格式
   */
  async function handleDecrypt(request) {
    try {
      const data = await request.json();
      if (!data.ciphertext || !data.password || !data.iv || !data.salt) {
        return new Response(
          JSON.stringify({ error: "缺少密文、密码、IV 或 salt" }),
          { status: 400, headers: { ...defaultHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (data.password.length < 8) {
        return new Response(
          JSON.stringify({ error: "密码至少8位" }),
          { status: 400, headers: { ...defaultHeaders, 'Content-Type': 'application/json' } }
        );
      }
  
      const encodingParam = new URL(request.url).searchParams.get('encoding') || 'base64';
      const encoding = Encodings[encodingParam] || Encodings['base64'];
  
      const algorithm = data.algorithm || 'AES-GCM';
      const iterations = data.iterations ? parseInt(data.iterations) : 100000;
      const saltBuffer = encoding.decode(data.salt);
      const ivBuffer = encoding.decode(data.iv);
      const ciphertextBuffer = encoding.decode(data.ciphertext);
  
      const key = await deriveKey(data.password, new Uint8Array(saltBuffer), iterations, algorithm);
      let decrypted;
      if (algorithm === 'AES-GCM') {
        decrypted = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: new Uint8Array(ivBuffer) },
          key,
          ciphertextBuffer
        );
      } else if (algorithm === 'AES-CBC') {
        decrypted = await crypto.subtle.decrypt(
          { name: "AES-CBC", iv: new Uint8Array(ivBuffer) },
          key,
          ciphertextBuffer
        );
      } else {
        return new Response(
          JSON.stringify({ error: "不支持的算法" }),
          { status: 400, headers: { ...defaultHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const dec = new TextDecoder();
      return new Response(
        JSON.stringify({ plaintext: dec.decode(decrypted) }),
        { headers: { ...defaultHeaders, 'Content-Type': 'application/json' } }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ error: "解密失败，请检查密码或数据完整性" }),
        { status: 500, headers: { ...defaultHeaders, 'Content-Type': 'application/json' } }
      );
    }
  }
  
  /**
   * 使用 PBKDF2 从密码中派生 AES 密钥
   */
  async function deriveKey(password, salt, iterations, algorithm = 'AES-GCM') {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: iterations,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: algorithm, length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }
  
  /**
   * 参数校验：验证加密请求的输入完整性
   */
  function validateEncrypt(data) {
    if (!data.plaintext || !data.plaintext.trim()) return "明文不能为空";
    if (!data.password || !data.password.trim()) return "密码不能为空";
    return null;
  }
  
  /**
   * 工具函数：ArrayBuffer 转 Base64 字符串
   */
  function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  
  /**
   * 工具函数：Base64 字符串转 ArrayBuffer
   */
  function base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
  
  /**
   * 工具函数：ArrayBuffer 转 Hex 编码字符串
   */
  function arrayBufferToHex(buffer) {
    return [...new Uint8Array(buffer)]
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
  
  /**
   * 工具函数：Hex 编码字符串转 ArrayBuffer
   */
  function hexToArrayBuffer(hex) {
    const bytes = new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    return bytes.buffer;
  }
  
  /**
   * 美化后的 HTML 页面
   */
  const html = `
  <!DOCTYPE html>
  <html lang="zh">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>在线加密解密及 URL 编码/解码工具</title>
    <!-- 引入 Google Fonts -->
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
    <style>
      /* 全局重置及盒模型设置 */
      * {
        box-sizing: border-box;
      }
      body {
        font-family: 'Roboto', sans-serif;
        background: linear-gradient(135deg, #74ABE2, #5563DE);
        margin: 0;
        padding: 20px;
        color: #333;
        min-height: 100vh;
      }
      .container {
        max-width: 900px;
        margin: 40px auto;
        background: #fff;
        padding: 30px;
        border-radius: 10px;
        box-shadow: 0 8px 16px rgba(0, 0, 0, 0.2);
      }
      h1, h2 {
        text-align: center;
        color: #333;
        margin-bottom: 20px;
      }
      h1 {
        font-size: 2em;
        margin-bottom: 10px;
      }
      h2 {
        font-size: 1.5em;
        margin-top: 30px;
        margin-bottom: 15px;
        border-bottom: 2px solid #e0e0e0;
        padding-bottom: 5px;
      }
      form {
        margin-bottom: 20px;
      }
      label {
        display: block;
        margin-bottom: 5px;
        font-weight: 500;
      }
      textarea, input[type="text"], input[type="password"], input[type="number"], select {
        width: 100%;
        padding: 10px;
        margin-bottom: 15px;
        border: 1px solid #ccc;
        border-radius: 5px;
        font-size: 1em;
      }
      textarea {
        resize: vertical;
      }
      button {
        background-color: #5563DE;
        color: #fff;
        border: none;
        padding: 10px 20px;
        margin: 5px 2px;
        border-radius: 5px;
        cursor: pointer;
        font-size: 1em;
        transition: background-color 0.3s ease;
      }
      button:hover {
        background-color: #3c44b1;
      }
      pre {
        background: #f5f5f5;
        padding: 15px;
        border-radius: 5px;
        white-space: pre-wrap;
        font-size: 0.9em;
        overflow-x: auto;
      }
      @media (max-width: 600px) {
        .container {
          padding: 20px;
        }
        button {
          width: 100%;
          margin: 8px 0;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>在线加密解密及 URL 编码/解码工具</h1>
      <h2>URL 编码/解码</h2>
      <form id="urlForm">
        <label for="inputUrl">请输入 URL 编码字符串：</label>
        <textarea id="inputUrl" rows="4" placeholder="输入 URL 编码后的字符串..."></textarea>
        
        <div style="text-align: center;">
          <button type="button" onclick="urlDecode()">解码</button>
          <button type="button" onclick="urlEncode()">编码</button>
        </div>
      </form>
      <pre id="urlResult"></pre>
      <div style="text-align: center;">
        <button type="button" onclick="copyResult('urlResult')">复制结果</button>
      </div>
      <h2>加密</h2>
      <form id="encryptForm">
        <label for="plaintext">明文：</label>
        <textarea id="plaintext" rows="4" placeholder="请输入明文"></textarea>
        
        <label for="encryptPassword">密码：</label>
        <input type="password" id="encryptPassword" placeholder="至少8位">
        
        <label for="algorithm">算法：</label>
        <select id="algorithm">
           <option value="AES-GCM">AES-GCM</option>
           <option value="AES-CBC">AES-CBC</option>
        </select>
        
        <label for="encoding">编码格式：</label>
        <select id="encoding">
           <option value="base64">Base64</option>
           <option value="base64url">Base64 URL Safe</option>
           <option value="hex">Hex</option>
        </select>
        
        <label for="iterations">迭代次数：</label>
        <input type="number" id="iterations" value="100000">
        
        <div style="text-align: center;">
          <button type="submit">加密</button>
          <button type="button" id="loadExample">填充示例数据</button>
        </div>
      </form>
      <pre id="encryptResult"></pre>
      <div style="text-align: center;">
        <button type="button" onclick="copyResult('encryptResult')">复制结果</button>
        <button type="button" onclick="downloadEncrypted()">下载结果</button>
      </div>
      
      <h2>解密</h2>
      <form id="decryptForm">
        <label for="ciphertext">密文：</label>
        <textarea id="ciphertext" rows="4" placeholder="请输入密文"></textarea>
        
        <label for="iv">IV：</label>
        <input type="text" id="iv" placeholder="编码后的 IV">
        
        <label for="salt">Salt：</label>
        <input type="text" id="salt" placeholder="编码后的 Salt">
        
        <label for="decryptPassword">密码：</label>
        <input type="password" id="decryptPassword" placeholder="至少8位">
        
        <label for="decryptAlgorithm">算法：</label>
        <select id="decryptAlgorithm">
           <option value="AES-GCM">AES-GCM</option>
           <option value="AES-CBC">AES-CBC</option>
        </select>
        
        <label for="decryptEncoding">编码格式：</label>
        <select id="decryptEncoding">
           <option value="base64">Base64</option>
           <option value="base64url">Base64 URL Safe</option>
           <option value="hex">Hex</option>
        </select>
        
        <label for="decryptIterations">迭代次数：</label>
        <input type="number" id="decryptIterations" value="100000">
        
        <div style="text-align: center;">
          <button type="submit">解密</button>
        </div>
      </form>
      <pre id="decryptResult"></pre>
      <div style="text-align: center;">
        <button type="button" onclick="copyResult('decryptResult')">复制结果</button>
      </div>
    </div>
    
    <script>
      // 加密表单提交处理
      document.getElementById('encryptForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const plaintext = document.getElementById('plaintext').value;
        const password = document.getElementById('encryptPassword').value;
        const algorithm = document.getElementById('algorithm').value;
        const encoding = document.getElementById('encoding').value;
        const iterations = document.getElementById('iterations').value;
        const response = await fetch('/encrypt?encoding=' + encoding, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plaintext, password, algorithm, iterations })
        });
        const result = await response.json();
        document.getElementById('encryptResult').textContent = JSON.stringify(result, null, 2);
      });
  
      // 解密表单提交处理
      document.getElementById('decryptForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const ciphertext = document.getElementById('ciphertext').value;
        const iv = document.getElementById('iv').value;
        const salt = document.getElementById('salt').value;
        const password = document.getElementById('decryptPassword').value;
        const algorithm = document.getElementById('decryptAlgorithm').value;
        const encoding = document.getElementById('decryptEncoding').value;
        const iterations = document.getElementById('decryptIterations').value;
        const response = await fetch('/decrypt?encoding=' + encoding, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ciphertext, iv, salt, password, algorithm, iterations })
        });
        const result = await response.json();
        document.getElementById('decryptResult').textContent = JSON.stringify(result, null, 2);
      });
  
      // URL 编码/解码功能（客户端实现）
      function urlDecode() {
        const input = document.getElementById('inputUrl').value;
        try {
          const decoded = decodeURIComponent(input);
          document.getElementById('urlResult').textContent = decoded;
        } catch (e) {
          document.getElementById('urlResult').textContent = "解码错误: " + e;
        }
      }
      function urlEncode() {
        const input = document.getElementById('inputUrl').value;
        try {
          const encoded = encodeURIComponent(input);
          document.getElementById('urlResult').textContent = encoded;
        } catch (e) {
          document.getElementById('urlResult').textContent = "编码错误: " + e;
        }
      }
  
      // 一键复制功能
      function copyResult(id) {
        const text = document.getElementById(id).textContent;
        navigator.clipboard.writeText(text);
        alert('已复制到剪贴板');
      }
  
      // 下载加密结果为 JSON 文件
      function downloadEncrypted() {
        const resultText = document.getElementById('encryptResult').textContent;
        const blob = new Blob([resultText], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'encrypted_data.json';
        link.click();
      }
  
      // 填充示例数据
      document.getElementById('loadExample').addEventListener('click', () => {
        document.getElementById('plaintext').value = 'Hello World!';
        document.getElementById('encryptPassword').value = 'securepassword123';
      });
    </script>
  </body>
  </html>
  `;
  