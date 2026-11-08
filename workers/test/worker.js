export default {
    async fetch(request, env, ctx) {
      // 获取 Cloudflare 提供的客户端信息
      const cf = request.cf || {};
  
      // 精选需要显示的核心字段及新增的字段
      const info = {
        // IP 地址：尝试多个 header 获取真实 IP
        ip:
          request.headers.get("CF-Connecting-IP") ||
          request.headers.get("X-Forwarded-For") ||
          request.headers.get("Remote-Addr") ||
          "N/A",
        // 地理位置信息
        country: cf.country,
        city: cf.city,
        region: cf.region,
        latitude: cf.latitude,
        longitude: cf.longitude,
        continent: cf.continent,
        regionCode: cf.regionCode,
        postalCode: cf.postalCode,
        timezone: cf.timezone,
        metroCode: cf.metroCode,
        // 网络相关信息
        asn: cf.asn,
        asOrganization: cf.asOrganization,
        // 协议信息
        httpProtocol: cf.httpProtocol,
        // Cloudflare 基础设施信息
        colo: cf.colo,
        // 安全相关字段
        isEUCountry: cf.isEUCountry,
        clientTrustScore: cf.clientTrustScore,
        // TLS 信息
        tlsVersion: cf.tlsVersion,
        tlsCipher: cf.tlsCipher,
        // Bot 管理评分（Cloudflare 可能通过 cf.botManagement 返回）
        botScore: cf.botManagement?.score ?? "N/A",
        // 威胁分数
        threatScore: cf.threatScore,
        // 请求头信息
        acceptLanguage: request.headers.get("Accept-Language") || "N/A",
        referer: request.headers.get("Referer") || "N/A",
        acceptEncoding: request.headers.get("Accept-Encoding") || "N/A",
        userAgent: request.headers.get("User-Agent") || "N/A",
        // 其他字段
        workerLocation: cf.colo || "N/A", // 当前 Worker 所在的 Cloudflare 数据中心
        // Edge Server IP：使用 CF-Ray 头部的第一部分作为边缘服务器 IP
        rayId:
          request.headers.get("CF-Ray") || "N/A"
      };
  
      // 构造表格行的辅助函数
      const escapeHtml = value => String(value ?? "N/A").replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[char]));
      const hasCoordinate = value => value !== undefined && value !== null &&
        String(value).trim() !== '' && Number.isFinite(Number(value));
      const buildRow = (title, value) => `
        <tr>
          <td>${escapeHtml(title)}</td>
          <td>${escapeHtml(value)}</td>
        </tr>`;
  
      // 构造 HTML 响应内容
      const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Client Info</title>
            <style>
                body {
                    font-family: system-ui, -apple-system, sans-serif;
                    background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
                    margin: 0;
                    padding: 2rem;
                    min-height: 100vh;
                }
                .container {
                    max-width: 800px;
                    margin: 0 auto;
                    background: rgba(255, 255, 255, 0.95);
                    backdrop-filter: blur(10px);
                    border-radius: 1rem;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
                    overflow: hidden;
                }
                h1 {
                    background: #2196F3;
                    color: white;
                    margin: 0;
                    padding: 1.5rem;
                    font-weight: 600;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    background: white;
                }
                th {
                    background: #f8f9fa;
                    text-align: left;
                    padding: 1rem;
                    border-bottom: 2px solid #dee2e6;
                }
                td {
                    padding: 1rem;
                    border-bottom: 1px solid #dee2e6;
                }
                tr:nth-child(even) {
                    background-color: #f8fafc;
                }
                .geo-pin {
                    color: #e91e63;
                    margin-right: 0.5rem;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🌍 Client Information Report</h1>
                <table>
                    ${buildRow("IP Address", info.ip)}
                    ${buildRow(
                      "Geo Location",
                      [info.city, info.region, info.country].filter(Boolean).join(", ") ||
                        "N/A"
                    )}
                    ${buildRow(
                      "Coordinates",
                      (hasCoordinate(info.latitude) && hasCoordinate(info.longitude))
                        ? `${Number(info.latitude).toFixed(4)}, ${Number(
                            info.longitude
                          ).toFixed(4)}`
                        : "N/A"
                    )}
                    ${buildRow(
                      "Network",
                      info.asn ? `AS${info.asn} - ${info.asOrganization}` : "N/A"
                    )}
                    ${buildRow("Continent", info.continent)}
                    ${buildRow("Region Code", info.regionCode)}
                    ${buildRow("Postal Code", info.postalCode)}
                    ${buildRow("Metro Code", info.metroCode)}
                    ${buildRow("Timezone", info.timezone)}
                    ${buildRow(
                      "EU Country",
                      typeof info.isEUCountry === "boolean"
                        ? info.isEUCountry
                          ? "✅ Yes"
                          : "❌ No"
                        : "N/A"
                    )}
                    ${buildRow("Protocol", info.httpProtocol || "N/A")}
                    ${buildRow(
                      "Trust Score",
                      info.clientTrustScore != null ? `${info.clientTrustScore}/100` : "N/A"
                    )}
                    ${buildRow("TLS Version", info.tlsVersion || "N/A")}
                    ${buildRow("TLS Cipher", info.tlsCipher || "N/A")}
                    ${buildRow("Bot Score", info.botScore)}
                    ${buildRow("Threat Score", info.threatScore ?? "N/A")}
                    ${buildRow("Cloudflare POP", info.colo || "N/A")}
                    ${buildRow("Worker Location", info.workerLocation)}
                    ${buildRow("Cloudflare Ray ID", info.rayId)}
                    ${buildRow("Accept-Language", info.acceptLanguage)}
                    ${buildRow("Referer", info.referer)}
                    ${buildRow("Accept-Encoding", info.acceptEncoding)}
                    ${buildRow("User Agent", info.userAgent)}
                </table>
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
  