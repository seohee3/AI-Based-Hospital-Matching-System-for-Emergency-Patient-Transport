// 최신 Expo 의 fetch 는 { uri, name, type } 형태의 파일 파트를 지원하지 않으므로,
// 파일 바이트를 읽어 multipart/form-data 본문을 직접 만든다.

function utf8(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.codePointAt(i);
    if (c > 0xffff) i++;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

export function buildMultipart(fields, fileField, fileName, fileType, fileBytes) {
  const boundary = '----ersync' + Math.random().toString(16).slice(2) + Date.now().toString(16);
  const chunks = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(utf8(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  chunks.push(utf8(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${fileName}"\r\nContent-Type: ${fileType}\r\n\r\n`
  ));
  chunks.push(fileBytes);
  chunks.push(utf8(`\r\n--${boundary}--\r\n`));

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const body = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { body.set(c, off); off += c.length; }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}
